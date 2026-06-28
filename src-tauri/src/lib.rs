// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件、管理全局状态
// 最后更新时间：2026-06-28-0339

pub mod device;
pub mod toolchain;
pub mod ai;

use ai::openai_compat::OpenAiCompatProvider;
use ai::{ChatMessage, FixSuggestion, GeneratedCode, LlmProvider, RequirementSpec, Verdict};
use device::serial_monitor::{SerialLine, SerialMonitor};
use device::DeviceInfo;
use serde::Serialize;
use std::path::PathBuf;
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
#[tauri::command]
fn start_monitor(
    port: String,
    baud: u32,
    on_line: Channel<SerialLine>,
    monitor: State<'_, Mutex<SerialMonitor>>,
) -> Result<(), String> {
    let monitor = monitor.lock().unwrap();
    monitor.start(&port, baud, on_line)
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

/// M3：创建 LLM 适配器（从 .env.local/环境变量读配置）
fn make_provider() -> Result<OpenAiCompatProvider, String> {
    OpenAiCompatProvider::from_env()
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
