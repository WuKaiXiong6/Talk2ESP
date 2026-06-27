// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件、管理全局状态
// 最后更新时间：2026-06-28-0339

mod device;

use device::serial_monitor::{SerialLine, SerialMonitor};
use device::DeviceInfo;
use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::State;

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
