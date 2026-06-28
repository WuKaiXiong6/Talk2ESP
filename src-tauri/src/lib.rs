// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件、管理全局状态
// 最后更新时间：2026-06-29-0130

pub mod device;
pub mod toolchain;
pub mod ai;
pub mod chips;
pub mod safety;
pub mod project;
pub mod orchestrator;
pub mod settings;

use ai::openai_compat::OpenAiCompatProvider;
use ai::{ChatMessage, FixSuggestion, GeneratedCode, LlmProvider, RequirementSpec, Verdict};
use device::serial_monitor::{SerialLine, SerialMonitor};
use device::DeviceInfo;
use orchestrator::{run_pipeline, PipelineConfig, PipelineEvent, PipelineOutcome};
use project::{ConversationMessage, Project, ProjectStorage, StageLog};
use safety::{check_code_pins, scan_dangerous_ops, DangerReport, PinViolations};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;
use toolchain::{compile_project, flash_project, ToolEvent};

/// M0 遗留：简化串口信息（仅 VID/PID），保留兼容
#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub name: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
}

/// M0：枚举 USB 串口（仅元数据）
#[tauri::command]
fn scan_ports() -> Vec<PortInfo> {
    let ports = serialport::available_ports().unwrap_or_default();
    ports
        .into_iter()
        .filter_map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => Some(PortInfo {
                name: p.port_name,
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                product: usb.product,
                manufacturer: usb.manufacturer,
                serial_number: usb.serial_number,
            }),
            _ => None,
        })
        .collect()
}

/// M1：扫描设备并调 esptool 探测芯片型号
#[tauri::command]
fn scan_devices() -> Vec<DeviceInfo> {
    device::scan_devices()
}

/// #52 根据 VID/PID 推测 USB-串口驱动信息
#[tauri::command]
fn check_driver(vid: Option<u16>, pid: Option<u16>) -> Option<device::DriverInfo> {
    device::check_driver(vid, pid)
}

/// #45 测试设备连接：打开串口并短暂读取判断响应
#[tauri::command]
fn test_device_connection(port: String, baud: Option<u32>) -> device::ConnectionTestResult {
    device::test_device_connection(&port, baud.unwrap_or(115200))
}

/// #35 自动探测设备当前波特率：逐个常见波特率尝试读取，命中则返回
/// 探测失败返回 None（前端提示用户手动选择）
#[tauri::command]
fn detect_baud(port: String) -> Option<u32> {
    device::detect_baud(&port)
}

/// M1：启动某端口的串口监控，行输出经 Channel 推送前端
/// #40 新增可选串口参数（data_bits/parity/stop_bits），缺省时保持 8N1 兼容既有行为
#[tauri::command]
fn start_monitor(
    port: String,
    baud: u32,
    on_line: Channel<SerialLine>,
    monitor: State<'_, Mutex<SerialMonitor>>,
    data_bits: Option<u8>,
    parity: Option<String>,
    stop_bits: Option<String>,
) -> Result<(), String> {
    let monitor = monitor.lock().unwrap();
    // 构造可选串口参数；None 表示沿用 serialport 默认（8N1）
    let params = match (data_bits, parity.as_deref(), stop_bits.as_deref()) {
        (Some(db), Some(pa), Some(sb)) => Some(device::SerialParams {
            data_bits: db,
            parity: pa.to_string(),
            stop_bits: sb.to_string(),
        }),
        _ => None,
    };
    monitor.start_with_params(&port, baud, params, on_line)
}

/// M1：向某端口发送一行数据
#[tauri::command]
fn send_serial(
    port: String,
    data: String,
    monitor: State<'_, Mutex<SerialMonitor>>,
) -> Result<(), String> {
    let monitor = monitor.lock().unwrap();
    monitor.send(&port, &data)
}

/// #36 发送原始字节：前端按需拼接换行符(CRLF/LF)或解析十六进制后传入
/// 既保持 send_serial 既有行为，又支持换行选择与十六进制发送
#[tauri::command]
fn send_serial_raw(
    port: String,
    bytes: Vec<u8>,
    monitor: State<'_, Mutex<SerialMonitor>>,
) -> Result<(), String> {
    let monitor = monitor.lock().unwrap();
    monitor.send_raw(&port, &bytes)
}

/// M1：停止某端口监控
#[tauri::command]
fn stop_monitor(port: String, monitor: State<'_, Mutex<SerialMonitor>>) -> Result<(), String> {
    let monitor = monitor.lock().unwrap();
    monitor.stop(&port)
}

/// M1：列出当前监控中的端口
#[tauri::command]
fn active_monitors(monitor: State<'_, Mutex<SerialMonitor>>) -> Vec<String> {
    monitor.lock().unwrap().active_ports()
}

/// M2：编译 Arduino 项目，流式日志经 Channel 推送
#[tauri::command]
fn compile_sketch(
    sketch_path: String,
    fqbn: String,
    on_event: Channel<ToolEvent>,
) -> Result<toolchain::ToolResult, String> {
    let path = PathBuf::from(&sketch_path);
    compile_project(&path, &fqbn, move |ev| {
        let _ = on_event.send(ev);
    })
}

/// M2：烧录 Arduino 项目，流式日志经 Channel 推送
#[tauri::command]
fn flash_sketch(
    sketch_path: String,
    fqbn: String,
    port: String,
    on_event: Channel<ToolEvent>,
) -> Result<toolchain::ToolResult, String> {
    let path = PathBuf::from(&sketch_path);
    flash_project(&path, &fqbn, &port, move |ev| {
        let _ = on_event.send(ev);
    })
}

/// M3：创建 LLM 适配器（优先从用户设置读，回退 .env.local/环境变量）
fn make_provider() -> Result<OpenAiCompatProvider, String> {
    let settings = settings::load_settings();
    if settings::is_llm_configured(&settings) {
        // 从用户设置构造（max_tokens 钳制到合理范围，避免超大值触发 API 400）
        let max_tokens = settings.llm.clamped_max_tokens();
        Ok(OpenAiCompatProvider::new(ai::openai_compat::OpenAiCompatConfig {
            base_url: settings.llm.base_url,
            api_key: settings.llm.api_key,
            model: settings.llm.model,
            max_tokens,
        }))
    } else {
        // 回退到环境变量/.env.local（开发期）
        OpenAiCompatProvider::from_env()
    }
}

/// #25 全局流水线取消令牌注册表：project_id -> AtomicBool
/// 流水线启动时注册，取消时置 true，流水线在阶段间隙检查并终止
static CANCEL_FLAGS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// #24 全局烧录确认令牌注册表：project_id -> AtomicBool
/// 仅当 confirm_before_flash=true 时使用，前端确认后置 true，流水线继续烧录
static FLASH_CONFIRM_FLAGS: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// M3：通用对话
#[tauri::command]
async fn llm_chat(messages: Vec<ChatMessage>) -> Result<String, String> {
    let provider = make_provider()?;
    provider.chat(messages).await
}

/// #73 流式对话：增量推送内容片段经 Channel，返回完整文本
/// 注意：既有 llm_chat（非流式）行为不变，此为新增能力
#[tauri::command]
async fn llm_chat_stream(
    messages: Vec<ChatMessage>,
    on_chunk: Channel<String>,
) -> Result<String, String> {
    let provider = make_provider()?;
    provider
        .chat_stream(messages, |chunk| {
            // 推送每个增量片段到前端；始终返回 true（不提前终止）
            let _ = on_chunk.send(chunk.to_string());
            true
        })
        .await
}

/// #75 需求确认书草稿：将自然语言转为结构化 RequirementSpec（不强制，流水线默认仍直接生成代码）
#[tauri::command]
async fn llm_draft_requirement(
    natural_language: String,
    chip: String,
) -> Result<RequirementSpec, String> {
    let provider = make_provider()?;
    let messages = ai::prompts::build_requirement_messages(&natural_language, &chip);
    let text = provider.chat(messages).await?;
    // 解析为 RequirementSpec
    serde_json::from_str::<RequirementSpec>(&text)
        .map_err(|e| format!("解析需求确认书失败: {e}; 原文: {}", &text[..text.len().min(300)]))
}

/// M3：根据需求确认书生成代码
#[tauri::command]
async fn llm_generate_code(spec: RequirementSpec) -> Result<GeneratedCode, String> {
    let provider = make_provider()?;
    provider.generate_code(&spec).await
}

/// #80 多模型对比生成：用指定的模型/base_url/api_key 临时构造 provider 生成一版代码
/// override 为 None 的字段回退到当前设置，便于「仅换模型名」对比
#[tauri::command]
async fn llm_generate_code_with_model(
    spec: RequirementSpec,
    model: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    max_tokens: Option<u32>,
) -> Result<GeneratedCode, String> {
    let settings = settings::load_settings();
    let base = if settings::is_llm_configured(&settings) {
        ai::openai_compat::OpenAiCompatConfig {
            base_url: settings.llm.base_url.clone(),
            api_key: settings.llm.api_key.clone(),
            model: settings.llm.model.clone(),
            max_tokens: settings.llm.clamped_max_tokens(),
        }
    } else {
        // 回退 env，再按 override 覆盖
        let p = OpenAiCompatProvider::from_env()?;
        p.config().clone()
    };
    let cfg = ai::openai_compat::OpenAiCompatConfig {
        base_url: base_url.unwrap_or(base.base_url),
        api_key: api_key.unwrap_or(base.api_key),
        model: model.unwrap_or(base.model),
        max_tokens: max_tokens
            .map(|m| m.clamp(256, 128000))
            .unwrap_or(base.max_tokens),
    };
    let provider = OpenAiCompatProvider::new(cfg);
    provider.generate_code(&spec).await
}

/// M3：诊断错误
#[tauri::command]
async fn llm_diagnose(error: String, context_code: String) -> Result<FixSuggestion, String> {
    let provider = make_provider()?;
    provider.diagnose(&error, &context_code).await
}

/// M3：验证判定
#[tauri::command]
async fn llm_judge(serial_output: String, expectation: String) -> Result<Verdict, String> {
    let provider = make_provider()?;
    provider.judge(&serial_output, &expectation).await
}

/// M4：校验代码引脚是否符合黑名单
#[tauri::command]
fn check_pins(code: String, chip: String) -> Result<PinViolations, String> {
    let descriptor = chips::load_descriptor(&chip)?;
    Ok(check_code_pins(&code, &descriptor))
}

/// M4：扫描代码危险操作
#[tauri::command]
fn scan_dangers(code: String) -> Vec<DangerReport> {
    scan_dangerous_ops(&code)
}

/// M4：列出已支持的芯片型号
#[tauri::command]
fn list_chips() -> Vec<String> {
    chips::list_supported_chips()
}

/// #67 获取芯片引脚描述符（用于引脚黑名单可视化）
#[tauri::command]
fn get_chip_descriptor(chip: String) -> Result<chips::ChipDescriptor, String> {
    chips::load_descriptor(&chip)
}

/// #97 列出内置示例库：扫描 examples/ 目录，返回示例名与 .ino 内容摘要
#[tauri::command]
fn list_examples() -> Vec<ExampleInfo> {
    let examples_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples");
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&examples_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                let ino_path = path.join(format!("{name}.ino"));
                if ino_path.exists() {
                    let code = std::fs::read_to_string(&ino_path).unwrap_or_default();
                    // 从头部注释提取简介（前几行非空注释）
                    let summary: String = code
                        .lines()
                        .filter(|l| l.trim_start().starts_with("//"))
                        .take(5)
                        .map(|l| l.trim_start_matches("/").trim().to_string())
                        .collect::<Vec<_>>()
                        .join("；");
                    result.push(ExampleInfo { name, code, summary });
                }
            }
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

/// #97 示例信息
#[derive(serde::Serialize)]
struct ExampleInfo {
    name: String,
    code: String,
    summary: String,
}

/// M5：创建项目
#[tauri::command]
fn create_project(
    name: String,
    chip: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Project, String> {
    let descriptor = chips::load_descriptor(&chip)?;
    let snapshot = project::model::PinBlacklistSnapshot {
        error: descriptor.pin_blacklist_error.clone(),
        warn: descriptor
            .pin_blacklist_warn
            .iter()
            .chain(descriptor.pin_blacklist_error_octal.iter().flatten())
            .copied()
            .collect(),
    };
    let storage = storage.lock().unwrap();
    storage.create_project(&name, &chip, snapshot, Some("openai_compat".into()))
}

/// M5：列出所有项目
#[tauri::command]
fn list_projects(storage: State<'_, Mutex<ProjectStorage>>) -> Result<Vec<Project>, String> {
    let storage = storage.lock().unwrap();
    storage.list_projects()
}

/// M5：加载单个项目
#[tauri::command]
fn load_project(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<Project, String> {
    let storage = storage.lock().unwrap();
    storage.load_project(&project_id)
}

/// M5：保存项目（更新元数据）
#[tauri::command]
fn save_project(project: Project, storage: State<'_, Mutex<ProjectStorage>>) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.save_project(&project)
}

/// M5：删除项目（#58 移到回收站，可恢复）
#[tauri::command]
fn delete_project(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.delete_project(&project_id)
}

/// #58 列出回收站中的项目 id
#[tauri::command]
fn list_trash(storage: State<'_, Mutex<ProjectStorage>>) -> Result<Vec<String>, String> {
    let storage = storage.lock().unwrap();
    storage.list_trash()
}

/// #58 恢复回收站中的项目
#[tauri::command]
fn restore_project(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.restore_project(&project_id)
}

/// #58 彻底删除回收站中的指定项目（不可恢复）
#[tauri::command]
fn purge_trash_project(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.purge_trash_project(&project_id)
}

/// #58 清空整个回收站（不可恢复），返回清空的项目数
#[tauri::command]
fn empty_trash(storage: State<'_, Mutex<ProjectStorage>>) -> Result<usize, String> {
    let storage = storage.lock().unwrap();
    storage.empty_trash()
}

/// #54 重命名项目
#[tauri::command]
fn rename_project(
    project_id: String,
    new_name: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Project, String> {
    let storage = storage.lock().unwrap();
    storage.rename_project(&project_id, &new_name)
}

/// #57 复制项目为副本
#[tauri::command]
fn duplicate_project(
    project_id: String,
    new_name: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Project, String> {
    let storage = storage.lock().unwrap();
    storage.duplicate_project(&project_id, &new_name)
}

/// #56 导出项目为 zip 字节流
#[tauri::command]
fn export_project(
    project_id: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Vec<u8>, String> {
    let storage = storage.lock().unwrap();
    storage.export_project(&project_id)
}

/// #56 从 zip 字节流导入项目
#[tauri::command]
fn import_project(
    zip_bytes: Vec<u8>,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Project, String> {
    let storage = storage.lock().unwrap();
    storage.import_project(&zip_bytes)
}

/// #71 清理旧数据：按日志保留天数删除超期日志，返回 (删除日志数, 项目数)
#[tauri::command]
fn cleanup_old_data(
    log_retention_days: u32,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<(usize, usize), String> {
    let storage = storage.lock().unwrap();
    storage.cleanup_old_data(log_retention_days)
}

/// #49 读取设备固件信息：调 esptool image_info 读取已烧录固件基本信息
#[tauri::command]
fn read_firmware_info(port: String) -> Result<String, String> {
    let output = std::process::Command::new("py")
        .args(["-m", "esptool", "-p", &port, "image_info"])
        .output()
        .map_err(|e| format!("调用 esptool 失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        // image_info 失败时返回错误信息（可能无固件或分区异常）
        Err(format!("读取固件信息失败: {}", stderr.lines().next().unwrap_or("未知错误")))
    }
}

/// #94 检查应用更新：返回当前版本（前端可对比远程版本号决定是否提示）
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// #94 远程更新检查：拉取 GitHub Releases 最新版本号与当前版本对比
/// 返回 (是否有更新, 最新版本号, 下载页 URL)；网络失败返回 (false, 当前版本, "")
/// 免依赖方案：直接 reqwest GitHub API，不引入 tauri-plugin-updater
#[tauri::command]
async fn check_for_update() -> Result<(bool, String, String), String> {
    const REPO: &str = "Wukaixiong/Talk2ESP";
    let current = env!("CARGO_PKG_VERSION");
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .user_agent("Talk2ESP-updater")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求 GitHub 失败: {e}"))?;
    if !resp.status().is_success() {
        return Ok((false, current.to_string(), String::new()));
    }
    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 Releases 响应失败: {e}"))?;
    let latest = json
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let html_url = json
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // 简单字符串比较：远程版本号不同且大于当前则认为有更新
    let has_update = !latest.is_empty() && latest != current;
    Ok((has_update, latest, html_url))
}

/// M5：追加对话消息
#[tauri::command]
fn append_message(
    project_id: String,
    message: ConversationMessage,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.append_message(&project_id, &message)
}

/// M5：加载对话记录
#[tauri::command]
fn load_messages(
    project_id: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<Vec<ConversationMessage>, String> {
    let storage = storage.lock().unwrap();
    storage.load_messages(&project_id)
}

/// M5：写入主程序代码
#[tauri::command]
fn write_main_code(
    project_id: String,
    code: String,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.write_main_code(&project_id, &code)
}

/// M5：读取主程序代码
#[tauri::command]
fn read_main_code(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<String, String> {
    let storage = storage.lock().unwrap();
    storage.read_main_code(&project_id)
}

/// M5：写入阶段日志
#[tauri::command]
fn write_stage_log(
    project_id: String,
    log: StageLog,
    storage: State<'_, Mutex<ProjectStorage>>,
) -> Result<String, String> {
    let storage = storage.lock().unwrap();
    let path = storage.write_stage_log(&project_id, &log)?;
    Ok(path.to_string_lossy().to_string())
}

/// 加载用户设置
#[tauri::command]
fn load_settings() -> settings::Settings {
    settings::load_settings()
}

/// 保存用户设置
#[tauri::command]
fn save_settings(settings: settings::Settings) -> Result<(), String> {
    settings::save_settings(&settings)
}

/// #72 导出设置：返回 settings.json 的 JSON 字符串（前端触发下载）
#[tauri::command]
fn export_settings() -> Result<String, String> {
    let s = settings::load_settings();
    serde_json::to_string_pretty(&s).map_err(|e| format!("序列化设置失败: {e}"))
}

/// #72 导入设置：接收 JSON 字符串，校验后写回 settings.json
/// 校验失败返回错误，不覆盖既有设置
#[tauri::command]
fn import_settings(json: String) -> Result<settings::Settings, String> {
    let parsed: settings::Settings = serde_json::from_str(&json)
        .map_err(|e| format!("设置文件格式无效: {e}"))?;
    settings::save_settings(&parsed)?;
    Ok(parsed)
}

/// 检查 LLM 是否已配置
#[tauri::command]
fn is_llm_configured() -> bool {
    settings::is_llm_configured(&settings::load_settings())
}

/// #63 测试 LLM 连接：发送一个最小请求验证配置可用
#[tauri::command]
async fn test_llm_connection() -> Result<String, String> {
    let provider = make_provider()?;
    // 发送最小对话请求验证连通性
    let reply = provider
        .chat(vec![ChatMessage::system("Reply with: ok")])
        .await
        .map_err(|e| format!("LLM 连接失败: {e}"))?;
    Ok(format!("连接成功，模型响应: {}", reply.chars().take(50).collect::<String>()))
}

/// #70 工具链健康检查：检测 arduino-cli 是否可用 + 版本 + 已安装核心
#[tauri::command]
fn check_toolchain() -> ToolchainStatus {
    check_toolchain_impl()
}

/// 工具链状态
#[derive(serde::Serialize)]
struct ToolchainStatus {
    /// arduino-cli 是否可解析
    cli_found: bool,
    /// arduino-cli 路径
    cli_path: Option<String>,
    /// 版本号
    version: Option<String>,
    /// 已安装的 ESP32 核心（fqbn 前缀）
    esp32_cores: Vec<String>,
    /// esptool 是否可用
    esptool_available: bool,
    /// 错误信息
    error: Option<String>,
}

/// 工具链检查实现
fn check_toolchain_impl() -> ToolchainStatus {
    // 1. 解析 arduino-cli 路径
    let cli_path = match toolchain::resolve_arduino_cli() {
        Ok(p) => p,
        Err(e) => {
            return ToolchainStatus {
                cli_found: false,
                cli_path: None,
                version: None,
                esp32_cores: Vec::new(),
                esptool_available: false,
                error: Some(format!("arduino-cli 未找到: {e}")),
            };
        }
    };
    let path_str = cli_path.to_string_lossy().to_string();

    // 2. 查询版本
    let version = std::process::Command::new(&cli_path)
        .arg("version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.lines().next().unwrap_or("").trim().to_string());

    // 3. 查询已安装核心
    let esp32_cores = std::process::Command::new(&cli_path)
        .args(["core", "list"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| {
            s.lines()
                .filter(|l| l.contains("esp32"))
                .filter_map(|l| l.split_whitespace().next().map(|x| x.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // 4. 检测 esptool（py -m esptool --version）
    let esptool_available = std::process::Command::new("py")
        .args(["-m", "esptool", "version"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    ToolchainStatus {
        cli_found: true,
        cli_path: Some(path_str),
        version,
        esp32_cores,
        esptool_available,
        error: None,
    }
}

/// M6：运行全自动流水线（需求确认书 → 代码 → 编译 → 烧录 → 验证）
/// #17 skip_coding_with_code 可选：传入则跳过 AI 生成，用用户编辑后的代码
#[tauri::command]
async fn run_full_pipeline(
    spec: RequirementSpec,
    port: String,
    project_id: String,
    on_event: Channel<PipelineEvent>,
    skip_coding_with_code: Option<String>,
) -> Result<PipelineOutcome, String> {
    // 先检查 LLM 是否已配置，未配置给明确引导
    let settings = settings::load_settings();
    // #17 若跳过 AI 生成，则不强制要求 LLM 配置
    if skip_coding_with_code.is_none() && !settings::is_llm_configured(&settings) {
        return Err("LLM 未配置：请先到「设置」界面填写 Base URL、API Key、模型名".into());
    }
    let provider = Arc::new(make_provider()?);
    let storage = Arc::new(tokio::sync::Mutex::new(ProjectStorage::from_default()));
    // #25 注册取消令牌
    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    // #24 烧录确认令牌
    let flash_confirmed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut flags = CANCEL_FLAGS.lock().unwrap();
        flags.insert(project_id.clone(), cancel_flag.clone());
        // #24 同时注册烧录确认令牌
        FLASH_CONFIRM_FLAGS.lock().unwrap().insert(project_id.clone(), flash_confirmed.clone());
    }
    let config = PipelineConfig {
        project_id: project_id.clone(),
        spec,
        port,
        auto_mode: settings.automation.mode == "full",
        skip_coding_with_code,
        cancel_flag,
        flash_confirmed,
        confirm_before_flash: settings.automation.confirm_before_flash,
        // #69 各阶段重试上限（已钳制到 [0,5]）
        max_retry: orchestrator::MaxRetry {
            compile: settings.retry.clamped_compile(),
            flash: settings.retry.clamped_flash(),
            verify: settings.retry.clamped_verify(),
        },
    };
    let result = run_pipeline(storage, provider, config, move |event| {
        let _ = on_event.send(event);
    })
    .await;
    // 清理令牌
    CANCEL_FLAGS.lock().unwrap().remove(&project_id);
    FLASH_CONFIRM_FLAGS.lock().unwrap().remove(&project_id);
    result
}

/// #25 取消正在运行的流水线：置取消令牌，流水线在下一个阶段间隙终止
#[tauri::command]
fn cancel_pipeline(project_id: String) -> Result<bool, String> {
    let flags = CANCEL_FLAGS.lock().unwrap();
    if let Some(flag) = flags.get(&project_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false) // 无运行中的流水线
    }
}

/// #24 确认烧录：置烧录确认令牌，使等待中的流水线继续进入烧录
#[tauri::command]
fn confirm_flash(project_id: String) -> Result<bool, String> {
    let flags = FLASH_CONFIRM_FLAGS.lock().unwrap();
    if let Some(flag) = flags.get(&project_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(true)
    } else {
        Ok(false) // 无等待确认的流水线
    }
}

/// Channel 流式通信验证（M0 遗留）
#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data")]
pub enum TickEvent {
    Tick { count: u32 },
    Done,
}

#[tauri::command]
fn start_tick(on_event: Channel<TickEvent>) {
    std::thread::spawn(move || {
        for i in 1..=5u32 {
            let _ = on_event.send(TickEvent::Tick { count: i });
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        let _ = on_event.send(TickEvent::Done);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(SerialMonitor::new()))
        .manage(Mutex::new(ProjectStorage::from_default()))
        .invoke_handler(tauri::generate_handler![
            scan_ports,
            scan_devices,
            check_driver,
            test_device_connection,
            detect_baud,
            start_monitor,
            send_serial,
            send_serial_raw,
            stop_monitor,
            active_monitors,
            compile_sketch,
            flash_sketch,
            llm_chat,
            llm_chat_stream,
            llm_draft_requirement,
            llm_generate_code,
            llm_generate_code_with_model,
            llm_diagnose,
            llm_judge,
            check_pins,
            scan_dangers,
            list_chips,
            get_chip_descriptor,
            list_examples,
            create_project,
            list_projects,
            load_project,
            save_project,
            delete_project,
            list_trash,
            restore_project,
            purge_trash_project,
            empty_trash,
            rename_project,
            duplicate_project,
            export_project,
            import_project,
            cleanup_old_data,
            read_firmware_info,
            get_app_version,
            check_for_update,
            append_message,
            load_messages,
            write_main_code,
            read_main_code,
            write_stage_log,
            load_settings,
            save_settings,
            export_settings,
            import_settings,
            is_llm_configured,
            test_llm_connection,
            check_toolchain,
            run_full_pipeline,
            cancel_pipeline,
            confirm_flash,
            start_tick
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证串口枚举能识别 CH343 USB 串口（VID 0x1A86）
    #[test]
    fn scan_ports_detects_ch343() {
        let ports = scan_ports();
        assert!(!ports.is_empty(), "应至少检测到一个 USB 串口");
        let ch343_count = ports.iter().filter(|p| p.vid == Some(0x1A86)).count();
        assert!(
            ch343_count >= 2,
            "应检测到至少 2 个 CH343 串口(两块ESP32-S3)，实际: {ch343_count}"
        );
    }
}
