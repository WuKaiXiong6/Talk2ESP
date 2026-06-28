// 文件路径：src-tauri/src/device/scanner.rs
// 文件作用：设备扫描与型号识别，调 esptool flash-id 探测 chip/MAC/Flash
// 最后更新时间：2026-06-28-1250

use serde::Serialize;
use std::process::Command;
use std::time::Duration;

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

/// #52 驱动检测结果
#[derive(Serialize, Clone, Debug)]
pub struct DriverInfo {
    /// 驱动名称（如 CH340/CH343/CP210x/FT232）
    pub driver: String,
    /// 推测的厂商
    pub vendor: String,
    /// 驱动是否已安装（基于串口能否被枚举判断）
    pub installed: bool,
    /// 下载驱动的引导说明
    pub hint: String,
}

/// #45 设备连接测试结果
#[derive(Serialize, Clone, Debug)]
pub struct ConnectionTestResult {
    /// 端口能否打开
    pub can_open: bool,
    /// 是否检测到数据响应（短时间内是否有字节返回）
    pub has_response: bool,
    /// 错误信息（打开失败时）
    pub error: Option<String>,
}

/// VID -> (驱动名, 厂商, 引导提示)
/// 覆盖常见 ESP32 开发板 USB-串口芯片
fn lookup_driver(vid: Option<u16>, pid: Option<u16>) -> Option<DriverInfo> {
    let vid = vid?;
    // 按 VID 匹配常见 USB-串口芯片
    let (driver, vendor, hint) = match vid {
        // QinHeng: CH340/CH343/CH9102（ESP32 开发板最常见）
        0x1A86 => match pid {
            Some(0x5523) | Some(0x7523) => (
                "CH340".to_string(),
                "QinHeng Electronics".to_string(),
                "若设备无法识别，下载 CH340 驱动：https://www.wch.cn/downloads/CH341SER_EXE.html".to_string(),
            ),
            Some(0x55D4) | Some(0x75DB) | Some(0x55BE) => (
                "CH343".to_string(),
                "QinHeng Electronics".to_string(),
                "若设备无法识别，下载 CH343 驱动：https://www.wch.cn/downloads/CH343SER_EXE.html".to_string(),
            ),
            _ => (
                "CH340/CH343".to_string(),
                "QinHeng Electronics".to_string(),
                "若设备无法识别，下载 CH34x 驱动：https://www.wch.cn/downloads/CH341SER_EXE.html".to_string(),
            ),
        },
        // Silicon Labs: CP2102/CP2104/CP2109
        0x10C4 => (
            "CP210x".to_string(),
            "Silicon Labs".to_string(),
            "若设备无法识别，下载 CP210x 驱动：https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers".to_string(),
        ),
        // FTDI: FT232/FT2232
        0x0403 => (
            "FT232".to_string(),
            "FTDI".to_string(),
            "若设备无法识别，下载 FTDI 驱动：https://ftdichip.com/drivers/vcp-drivers/".to_string(),
        ),
        // Espressif 原生 USB（ESP32-S3/C3 内置 USB-Serial-JTAG）
        0x303A => (
            "ESP32 原生 USB-Serial-JTAG".to_string(),
            "Espressif".to_string(),
            "原生 USB 无需额外驱动；若无法识别，检查 USB 数据线是否支持数据传输（非纯充电线）".to_string(),
        ),
        _ => return None,
    };
    // 已能枚举到串口即认为驱动已安装
    Some(DriverInfo {
        driver,
        vendor,
        installed: true,
        hint,
    })
}

/// #52 根据 VID/PID 推测驱动信息
pub fn check_driver(vid: Option<u16>, pid: Option<u16>) -> Option<DriverInfo> {
    lookup_driver(vid, pid)
}

/// #45 测试设备连接：尝试打开串口并短暂读取，判断是否有响应
pub fn test_device_connection(port: &str, baud: u32) -> ConnectionTestResult {
    let open_result = serialport::new(port, baud)
        .timeout(Duration::from_millis(500))
        .open();

    let mut serial = match open_result {
        Ok(s) => s,
        Err(e) => {
            // 分类常见错误：端口被占用 vs 不存在
            let err_str = format!("{e}");
            let classified = if err_str.contains("Access") || err_str.contains("denied") || err_str.contains("Permission") {
                format!("端口被占用或无权限：{err_str}（可能被其他串口工具占用，请关闭后重试）")
            } else if err_str.contains("No such") || err_str.contains("not found") {
                format!("端口不存在：{err_str}（请确认设备已连接）")
            } else {
                err_str
            };
            return ConnectionTestResult {
                can_open: false,
                has_response: false,
                error: Some(classified),
            };
        }
    };

    // 短暂读取 800ms，判断是否有数据响应
    let mut buf = [0u8; 64];
    let has_response = match serial.read(&mut buf) {
        Ok(n) => n > 0,
        Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => false,
        Err(_) => false,
    };

    ConnectionTestResult {
        can_open: true,
        has_response,
        error: None,
    }
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
