// 文件路径：src-tauri/src/safety/mod.rs
// 文件作用：安全层模块入口，整合引脚黑名单校验与危险代码扫描
// 最后更新时间：2026-06-28-1011

pub mod danger_check;
pub mod pin_blacklist;

pub use danger_check::{scan_dangerous_ops, DangerReport, DangerType};
pub use pin_blacklist::{check_code_pins, PinViolation, PinViolations};
