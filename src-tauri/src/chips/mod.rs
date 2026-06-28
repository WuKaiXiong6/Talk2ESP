// 文件路径：src-tauri/src/chips/mod.rs
// 文件作用：型号描述表模块，加载 chips/*.toml 提供引脚黑名单/FQBN/Flash偏移
// 最后更新时间：2026-06-28-1011

use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;

/// 单个芯片的型号描述
#[derive(Deserialize, Clone, Debug)]
pub struct ChipDescriptor {
    pub chip: String,
    pub fqbn: String,
    pub flash_offset_app: String,
    pub pin_count: u32,
    pub pin_blacklist_error: Vec<u32>,
    pub pin_blacklist_error_octal: Option<Vec<u32>>,
    pub pin_blacklist_warn: Vec<u32>,
    pub pin_safe_default: Vec<u32>,
    pub pin_notes: Option<HashMap<String, String>>,
}

impl ChipDescriptor {
    /// 获取某引脚的告警级别（None=安全, Some(Error)/Some(Warn)）
    pub fn pin_level(&self, pin: u32) -> Option<PinLevel> {
        if self.pin_blacklist_error.contains(&pin) {
            return Some(PinLevel::Error);
        }
        // Octal 变体额外 Error（保守起见：无法识别型号时，33-37 当 Warn，见下）
        if let Some(octal) = &self.pin_blacklist_error_octal {
            if octal.contains(&pin) {
                // 默认按 Warn 处理（除非调用方确认是 Octal 变体）
                return Some(PinLevel::Warn);
            }
        }
        if self.pin_blacklist_warn.contains(&pin) {
            return Some(PinLevel::Warn);
        }
        None
    }

    /// 获取引脚说明
    pub fn pin_note(&self, pin: u32) -> Option<&String> {
        self.pin_notes.as_ref()?.get(&pin.to_string())
    }
}

/// 引脚告警级别
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PinLevel {
    /// 阻断：禁止使用
    Error,
    /// 提示：需用户确认
    Warn,
}

/// chips 目录路径（src-tauri/chips）
fn chips_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("chips")
}

/// 按芯片名加载描述表（如 "esp32s3" -> chips/esp32s3.toml）
pub fn load_descriptor(chip: &str) -> Result<ChipDescriptor, String> {
    let path = chips_dir().join(format!("{chip}.toml"));
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取芯片描述表 {} 失败: {e}", path.display()))?;
    toml::from_str(&content).map_err(|e| format!("解析芯片描述表失败: {e}"))
}

/// 列出所有已支持的芯片名
pub fn list_supported_chips() -> Vec<String> {
    let dir = chips_dir();
    let mut chips = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.path().file_stem().and_then(|s| s.to_str()) {
                chips.push(name.to_string());
            }
        }
    }
    chips
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_esp32s3_descriptor() {
        let d = load_descriptor("esp32s3").expect("加载 S3 描述表失败");
        assert_eq!(d.chip, "esp32s3");
        assert_eq!(d.fqbn, "esp32:esp32:esp32s3");
        assert!(d.pin_blacklist_error.contains(&45)); // VDD_SPI
        assert!(d.pin_blacklist_error.contains(&26)); // Flash
        assert_eq!(d.pin_level(45), Some(PinLevel::Error));
        assert_eq!(d.pin_level(0), Some(PinLevel::Warn)); // Strapping
        assert_eq!(d.pin_level(4), None); // 安全
    }

    #[test]
    fn load_esp32c3_descriptor() {
        let d = load_descriptor("esp32c3").expect("加载 C3 描述表失败");
        assert_eq!(d.chip, "esp32c3");
        assert!(d.pin_blacklist_error.contains(&12)); // Flash
        assert_eq!(d.pin_level(12), Some(PinLevel::Error));
        assert_eq!(d.pin_level(9), Some(PinLevel::Warn)); // Strapping
        assert_eq!(d.pin_level(6), None); // 安全
    }

    #[test]
    fn list_chips_contains_s3_c3() {
        let chips = list_supported_chips();
        assert!(chips.contains(&"esp32s3".to_string()));
        assert!(chips.contains(&"esp32c3".to_string()));
    }
}
