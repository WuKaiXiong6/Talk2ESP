// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件、管理全局状态
// 最后更新时间：2026-06-28-0339

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

/// M3：通用对话
#[tauri::command]
async fn llm_chat(messages: Vec<ChatMessage>) -> Result<String, String> {
    let provider = make_provider()?;
    provider.chat(messages).await
}

/// M3：根据需求确认书生成代码
#[tauri::command]
async fn llm_generate_code(spec: RequirementSpec) -> Result<GeneratedCode, String> {
    let provider = make_provider()?;
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

/// M5：删除项目
#[tauri::command]
fn delete_project(project_id: String, storage: State<'_, Mutex<ProjectStorage>>) -> Result<(), String> {
    let storage = storage.lock().unwrap();
    storage.delete_project(&project_id)
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

/// 检查 LLM 是否已配置
#[tauri::command]
fn is_llm_configured() -> bool {
    settings::is_llm_configured(&settings::load_settings())
}

/// M6：运行全自动流水线（需求确认书 → 代码 → 编译 → 烧录 → 验证）
#[tauri::command]
async fn run_full_pipeline(
    spec: RequirementSpec,
    port: String,
    project_id: String,
    on_event: Channel<PipelineEvent>,
) -> Result<PipelineOutcome, String> {
    // 先检查 LLM 是否已配置，未配置给明确引导
    let settings = settings::load_settings();
    if !settings::is_llm_configured(&settings) {
        return Err("LLM 未配置：请先到「设置」界面填写 Base URL、API Key、模型名".into());
    }
    let provider = Arc::new(make_provider()?);
    let storage = Arc::new(tokio::sync::Mutex::new(ProjectStorage::from_default()));
    let config = PipelineConfig {
        project_id,
        spec,
        port,
        auto_mode: settings.automation.mode == "full",
    };
    run_pipeline(storage, provider, config, move |event| {
        let _ = on_event.send(event);
    })
    .await
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
            start_monitor,
            send_serial,
            stop_monitor,
            active_monitors,
            compile_sketch,
            flash_sketch,
            llm_chat,
            llm_generate_code,
            llm_diagnose,
            llm_judge,
            check_pins,
            scan_dangers,
            list_chips,
            create_project,
            list_projects,
            load_project,
            save_project,
            delete_project,
            append_message,
            load_messages,
            write_main_code,
            read_main_code,
            write_stage_log,
            load_settings,
            save_settings,
            is_llm_configured,
            run_full_pipeline,
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
