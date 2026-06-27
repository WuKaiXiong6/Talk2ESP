// 文件路径：src-tauri/src/lib.rs
// 文件作用：Talk2ESP 应用入口，注册 Tauri 命令与插件
// 最后更新时间：2026-06-28-0332

use serde::Serialize;
use tauri::ipc::Channel;

/// 串口信息（仅 USB 串口），与前端 PortInfo 类型对齐
#[derive(Serialize, Clone)]
pub struct PortInfo {
    pub name: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
}

/// 枚举主机 USB 串口，返回含 VID/PID 的列表
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

/// Channel 流式通信验证：定时推送计数，5 次后完成
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
        .invoke_handler(tauri::generate_handler![scan_ports, start_tick])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证串口枚举能识别 CH343 USB 串口（VID 0x1A86）
    /// 测试环境：两块 ESP32-S3 经 CH343 接 COM4/COM8
    #[test]
    fn scan_ports_detects_ch343() {
        let ports = scan_ports();
        assert!(!ports.is_empty(), "应至少检测到一个 USB 串口");
        let ch343_count = ports
            .iter()
            .filter(|p| p.vid == Some(0x1A86))
            .count();
        assert!(
            ch343_count >= 2,
            "应检测到至少 2 个 CH343 串口(两块ESP32-S3)，实际: {ch343_count}"
        );
        // 确认 VID/PID 字段已填充
        for p in &ports {
            assert!(p.vid.is_some(), "USB 串口 {} 的 VID 不应为空", p.name);
            assert!(p.pid.is_some(), "USB 串口 {} 的 PID 不应为空", p.name);
        }
    }
}
