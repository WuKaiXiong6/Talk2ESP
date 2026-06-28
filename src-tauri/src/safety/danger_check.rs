// 文件路径：src-tauri/src/safety/danger_check.rs
// 文件作用：危险操作扫描（关闭看门狗/过载配置/改启动配置等），正则匹配
// 最后更新时间：2026-06-28-1011

use regex::Regex;

/// 危险操作类型
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub enum DangerType {
    /// 关闭看门狗
    DisableWatchdog,
    /// 修改启动配置
    BootConfigChange,
    /// 引脚过载/驱动模式修改
    PinDriveOverload,
    /// 直接操作 Flash
    FlashDirectAccess,
    /// 其他潜在危险
    Other,
}

/// 单个危险操作报告
#[derive(serde::Serialize, Clone, Debug)]
pub struct DangerReport {
    pub danger_type: String,
    pub description: String,
    pub context: String,
}

/// 扫描代码中的危险操作
pub fn scan_dangerous_ops(code: &str) -> Vec<DangerReport> {
    let mut reports = Vec::new();

    // 规则定义：(正则, 类型, 描述)
    let rules: &[(&str, DangerType, &str)] = &[
        // 关闭看门狗
        (r"disableCore0WDT|disableCore1WDT|disableLoopWDT|esp_task_wdt_delete", DangerType::DisableWatchdog, "关闭看门狗可能导致系统死锁无法恢复"),
        // 修改启动/efuse 配置
        (r"esp_efuse|bootloader|setPartitionTable|OTA.*boot", DangerType::BootConfigChange, "修改启动配置可能影响芯片启动"),
        // 引脚驱动能力过载
        (r"gpio_set_drive_capability|setDriveStrength|GPIO_DRIVE_CAP_3", DangerType::PinDriveOverload, "提高引脚驱动能力可能过载损坏引脚"),
        // 直接操作 Flash
        (r"spi_flash_erase_sector|esp_partition_write|SPIFlash\.erase", DangerType::FlashDirectAccess, "直接擦写 Flash 可能损坏固件"),
    ];

    for (pattern, dtype, desc) in rules {
        if let Ok(re) = Regex::new(pattern) {
            for (line_no, line) in code.lines().enumerate() {
                if re.is_match(line) {
                    reports.push(DangerReport {
                        danger_type: format!("{:?}", dtype),
                        description: desc.to_string(),
                        context: format!("L{}: {}", line_no + 1, line.trim()),
                    });
                }
            }
        }
    }

    reports
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_watchdog_disable() {
        let code = "void setup(){ disableCore0WDT(); }\nvoid loop(){}";
        let reports = scan_dangerous_ops(code);
        assert!(!reports.is_empty());
        assert!(reports.iter().any(|r| r.danger_type == "DisableWatchdog"));
    }

    #[test]
    fn detect_flash_access() {
        let code = "void loop(){ spi_flash_erase_sector(0); }";
        let reports = scan_dangerous_ops(code);
        assert!(reports.iter().any(|r| r.danger_type == "FlashDirectAccess"));
    }

    #[test]
    fn safe_code_no_danger() {
        let code = "void setup(){ Serial.begin(115200); pinMode(2, OUTPUT); }\nvoid loop(){ digitalWrite(2, HIGH); delay(500); }";
        let reports = scan_dangerous_ops(code);
        assert!(reports.is_empty(), "安全代码不应有危险报告");
    }
}
