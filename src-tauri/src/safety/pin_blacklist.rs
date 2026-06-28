// 文件路径：src-tauri/src/safety/pin_blacklist.rs
// 文件作用：引脚黑名单校验，提取代码中引用的引脚字面量并比对黑名单
// 最后更新时间：2026-06-28-1011

use crate::chips::{ChipDescriptor, PinLevel};

/// 单个引脚违规
#[derive(serde::Serialize, Clone, Debug)]
pub struct PinViolation {
    pub pin: u32,
    pub level: String, // "error" | "warn"
    pub note: Option<String>,
    /// 代码中引用该引脚的上下文行
    pub context: String,
}

/// 引脚校验结果
#[derive(serde::Serialize, Clone, Debug)]
pub struct PinViolations {
    pub errors: Vec<PinViolation>,
    pub warnings: Vec<PinViolation>,
    pub has_blocking: bool,
}

/// 从 Arduino 代码中提取引脚字面量及其上下文行
/// 匹配 pinMode/digitalWrite/digitalRead/analogRead/analogWrite/attachInterrupt 等函数的第一数字参数
fn extract_pin_references(code: &str) -> Vec<(u32, String)> {
    let mut refs = Vec::new();
    // 匹配常见 GPIO 函数 + 直接 GPIOxx 形式
    let funcs = [
        "pinMode", "digitalWrite", "digitalRead", "analogRead", "analogWrite",
        "attachInterrupt", "ledcAttachPin", "touchRead",
    ];
    for (line_no, line) in code.lines().enumerate() {
        let trimmed = line.trim();
        // 跳过注释行
        if trimmed.starts_with("//") || trimmed.starts_with("*") {
            continue;
        }
        for func in funcs {
            if let Some(idx) = line.find(func) {
                // 取函数名后到行尾的部分，找第一个数字
                let after = &line[idx + func.len()..];
                if let Some(pin) = extract_first_number(after) {
                    refs.push((pin, format!("L{}: {}", line_no + 1, trimmed)));
                    break;
                }
            }
        }
        // 匹配 GPIOxx 或 LED_BUILTIN 之外的直接数字常量赋值给引脚变量较难，这里聚焦函数调用
    }
    refs
}

/// 从字符串中提取第一个无符号整数
fn extract_first_number(s: &str) -> Option<u32> {
    let mut num_str = String::new();
    let mut started = false;
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            num_str.push(ch);
            started = true;
        } else if started {
            break;
        }
    }
    if num_str.is_empty() {
        None
    } else {
        num_str.parse().ok()
    }
}

/// 校验代码中引用的引脚是否符合黑名单
pub fn check_code_pins(code: &str, descriptor: &ChipDescriptor) -> PinViolations {
    let refs = extract_pin_references(code);
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    for (pin, context) in refs {
        match descriptor.pin_level(pin) {
            Some(PinLevel::Error) => errors.push(PinViolation {
                pin,
                level: "error".into(),
                note: descriptor.pin_note(pin).cloned(),
                context,
            }),
            Some(PinLevel::Warn) => warnings.push(PinViolation {
                pin,
                level: "warn".into(),
                note: descriptor.pin_note(pin).cloned(),
                context,
            }),
            None => {}
        }
    }

    // 去重（同一引脚多次引用只报一次，取首个上下文）
    errors.dedup_by(|a, b| a.pin == b.pin);
    warnings.dedup_by(|a, b| a.pin == b.pin);

    let has_blocking = !errors.is_empty();
    PinViolations { errors, warnings, has_blocking }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chips::load_descriptor;

    #[test]
    fn detect_error_pin_s3() {
        let d = load_descriptor("esp32s3").unwrap();
        // 误用 GPIO45（VDD_SPI）应阻断
        let code = "void setup(){ pinMode(45, OUTPUT); }\nvoid loop(){}";
        let result = check_code_pins(code, &d);
        assert!(result.has_blocking, "GPIO45 应触发 Error 阻断");
        assert!(result.errors.iter().any(|v| v.pin == 45));
    }

    #[test]
    fn detect_warn_pin_s3() {
        let d = load_descriptor("esp32s3").unwrap();
        // 使用 GPIO0（Strapping）应 Warn 不阻断
        let code = "void setup(){ pinMode(0, INPUT_PULLUP); }\nvoid loop(){}";
        let result = check_code_pins(code, &d);
        assert!(!result.has_blocking, "GPIO0 应 Warn 不阻断");
        assert!(result.warnings.iter().any(|v| v.pin == 0));
    }

    #[test]
    fn safe_pin_no_violation() {
        let d = load_descriptor("esp32s3").unwrap();
        let code = "void setup(){ pinMode(2, OUTPUT); digitalWrite(2, HIGH); }\nvoid loop(){}";
        let result = check_code_pins(code, &d);
        assert!(!result.has_blocking);
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn detect_flash_pin_c3() {
        let d = load_descriptor("esp32c3").unwrap();
        // 误用 GPIO12（Flash）应阻断
        let code = "void setup(){ pinMode(12, OUTPUT); }\nvoid loop(){}";
        let result = check_code_pins(code, &d);
        assert!(result.has_blocking);
        assert!(result.errors.iter().any(|v| v.pin == 12));
    }

    #[test]
    fn skip_comment_lines() {
        let d = load_descriptor("esp32s3").unwrap();
        // 注释行里的引脚不应触发
        let code = "// pinMode(45, OUTPUT);\nvoid setup(){ pinMode(4, OUTPUT); }\nvoid loop(){}";
        let result = check_code_pins(code, &d);
        assert!(!result.has_blocking, "注释行的引脚不应触发");
    }
}
