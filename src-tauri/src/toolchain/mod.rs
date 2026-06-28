// 文件路径：src-tauri/src/toolchain/mod.rs
// 文件作用：工具链层模块入口，封装 arduino-cli 编译与 esptool/arduino-cli 烧录
// 最后更新时间：2026-06-28-1300

pub mod arduino_cli;

pub use arduino_cli::{compile_project, flash_project, resolve_arduino_cli, ToolEvent, ToolResult};
