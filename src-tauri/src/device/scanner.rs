// 文件路径：src-tauri/src/device/scanner.rs
// 文件作用：设备扫描与型号识别，调 esptool flash-id 探测 chip/MAC/Flash
// 最后更新时间：2026-06-28-0339

use serde::Serialize;
use std::process::Command;

/// 完整设备信息：串口元数据 + esptool 探测结果
#[derive(Serialize, Clone, Debug)]
pub struct DeviceInfo {
    pub port: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub serial_number: Option<String>,
    /// esptool 探测的芯片型号（如 esp32s3），探测失败为 None
    pub chip: Option<String>,
    pub mac: Option<String>,
    pub flash_size: Option<String>,
    /// 探测是否成功
    pub detected: bool,
}

/// 枚举 USB 串口（仅 VID/PID 元数据，不调 esptool）
fn list_usb_ports() -> Vec<DeviceInfo> {
    let ports = serialport::available_ports().unwrap_or_default();
    ports
        .into_iter()
        .filter_map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => Some(DeviceInfo {
                port: p.port_name,
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                product: usb.product,
                manufacturer: usb.manufacturer,
                serial_number: usb.serial_number,
                chip: None,
                mac: None,
                flash_size: None,
                detected: false,
            }),
            _ => None,
        })
        .collect()
}

/// 调 `py -m esptool -p <port> flash-id` 探测芯片信息
/// 返回 (chip, mac, flash_size)，失败返回 None
fn probe_with_esptool(port: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let output = Command::new("py")
        .args(["-m", "esptool", "-p", port, "flash-id"])
        .stdin(std::process::Stdio::null())
        .output()
        .ok()?;

    // esptool 把主要信息输出到 stderr（历史原因）
    let text = String::from_utf8_lossy(&output.stderr);
    let text_stdout = String::from_utf8_lossy(&output.stdout);
    let combined = format!("{text}{text_stdout}");

    if !combined.contains("Chip type:") {
        return None;
    }

    let chip = combined
        .lines()
        .find(|l| l.contains("Chip type:"))
        .and_then(|l| l.split("Chip type:").nth(1))
        .and_then(|s| s.trim().split_whitespace().next())
        .map(|s| s.to_lowercase().replace('-', "")) // "ESP32-S3" -> "esp32s3"
        .map(normalize_chip);

    let mac = combined
        .lines()
        .find(|l| l.contains("MAC:"))
        .and_then(|l| l.split("MAC:").nth(1))
        .map(|s| s.trim().to_string());

    let flash_size = combined
        .lines()
        .find(|l| l.contains("Detected flash size:"))
        .and_then(|l| l.split("Detected flash size:").nth(1))
        .map(|s| s.trim().to_string());

    Some((chip, mac, flash_size))
}

/// 规范化芯片名：ESP32-S3 -> esp32s3, ESP32-C3 -> esp32c3, ESP32 -> esp32
fn normalize_chip(raw: String) -> String {
    let lower = raw.to_lowercase();
    lower.replace('-', "")
}

/// 扫描所有 USB 串口并对每个候选端口调 esptool 探测芯片型号
/// timeout_secs 限制单端口探测总时长
pub fn scan_devices() -> Vec<DeviceInfo> {
    let mut devices = list_usb_ports();
    for dev in &mut devices {
        if let Some((chip, mac, flash_size)) = probe_with_esptool(&dev.port) {
            dev.chip = chip;
            dev.mac = mac;
            dev.flash_size = flash_size;
            dev.detected = true;
        }
    }
    devices
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_usb_ports_finds_ch343() {
        let ports = list_usb_ports();
        assert!(!ports.is_empty(), "应至少检测到一个 USB 串口");
        let ch343 = ports.iter().filter(|p| p.vid == Some(0x1A86)).count();
        assert!(ch343 >= 2, "应检测到≥2个CH343串口，实际{ch343}");
    }

    #[test]
    fn scan_devices_detects_esp32s3() {
        // 测试环境：两块 ESP32-S3 经 CH343 接 COM4/COM8
        let devices = scan_devices();
        let s3 = devices
            .iter()
            .filter(|d| d.chip.as_deref() == Some("esp32s3"))
            .count();
        assert!(s3 >= 1, "应至少探测到1块ESP32-S3，实际{s3}");
        // 验证 MAC 与 flash_size 已填充
        for d in &devices {
            if d.detected {
                assert!(d.mac.is_some(), "已探测设备 {} 的 MAC 不应为空", d.port);
                assert!(d.flash_size.is_some(), "已探测设备 {} 的 flash_size 不应为空", d.port);
            }
        }
    }

    #[test]
    fn normalize_chip_works() {
        assert_eq!(normalize_chip("ESP32-S3".to_lowercase().replace('-', "")), "esp32s3");
        assert_eq!(normalize_chip("esp32c3".to_string()), "esp32c3");
    }
}
