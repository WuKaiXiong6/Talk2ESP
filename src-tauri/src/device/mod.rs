// 文件路径：src-tauri/src/device/mod.rs
// 文件作用：设备/串口层模块入口，整合扫描与监控
// 最后更新时间：2026-06-28-1245

pub mod scanner;
pub mod serial_monitor;

// lib.rs 通过 device::scan_devices / device::DeviceInfo 引用
pub use scanner::{scan_devices, DeviceInfo};
pub use serial_monitor::{SerialLine, SerialParams};
