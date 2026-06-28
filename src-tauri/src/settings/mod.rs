// 文件路径：src-tauri/src/settings/mod.rs
// 文件作用：用户设置模块，持久化到 ~/.talk2esp/settings.json，含 LLM/自动化/黑名单/工具链/数据管理/重试配置
// 最后更新时间：2026-06-29-0130

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 用户设置（持久化）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    /// LLM 配置
    pub llm: LlmSettings,
    /// 自动化模式
    pub automation: AutomationSettings,
    /// 自定义引脚黑名单（除内置外额外禁止）
    pub pin_blacklist: PinBlacklistSettings,
    /// 工具链/高级
    pub toolchain: ToolchainSettings,
    /// #71 日志与数据管理（新增字段，serde default 保证旧设置兼容）
    #[serde(default)]
    pub data_management: DataManagementSettings,
    /// #69 各阶段重试上限（新增字段，serde default 保证旧设置兼容）
    #[serde(default)]
    pub retry: RetrySettings,
}

/// LLM 配置
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LlmSettings {
    /// 供应商：openai_compat | claude
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
}

impl LlmSettings {
    /// 钳制 max_tokens 到合理范围 [256, 128000]，避免用户填超大值触发 API 400
    pub fn clamped_max_tokens(&self) -> u32 {
        self.max_tokens.clamp(256, 128000)
    }
}

/// 自动化模式
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AutomationSettings {
    /// full | step
    pub mode: String,
    /// 烧录前是否需要确认
    pub confirm_before_flash: bool,
}

/// 引脚黑名单自定义
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PinBlacklistSettings {
    /// 额外禁止的引脚（追加到内置黑名单）
    pub extra_error: Vec<u32>,
    /// 额外提示的引脚
    pub extra_warn: Vec<u32>,
}

/// 工具链/高级
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolchainSettings {
    /// arduino-cli 路径（空则用内置/默认）
    pub arduino_cli_path: String,
    /// 默认串口波特率
    pub default_baud: u32,
    /// 是否显示详细日志
    pub verbose_log: bool,
}

/// #71 日志与数据管理
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DataManagementSettings {
    /// 项目保留数量上限（0=不限），超出时提示清理
    pub max_projects: u32,
    /// 日志保留天数（0=不限），超出时自动清理 logs/
    pub log_retention_days: u32,
}

/// #69 各阶段重试上限配置
/// 各项取值范围 [0,5]：0 表示「失败不重试直接转人工」，默认 3 保持既有行为
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RetrySettings {
    /// 编译阶段重试上限
    pub compile: u32,
    /// 烧录阶段重试上限
    pub flash: u32,
    /// 验证阶段重试上限
    pub verify: u32,
}

impl Default for RetrySettings {
    fn default() -> Self {
        Self {
            compile: 3,
            flash: 3,
            verify: 3,
        }
    }
}

impl RetrySettings {
    /// 钳制单项到 [0,5]，避免用户填越界值
    pub fn clamp_one(v: u32) -> u32 {
        v.clamp(0, 5)
    }
    /// 钳制后的编译重试上限
    pub fn clamped_compile(&self) -> u32 {
        Self::clamp_one(self.compile)
    }
    /// 钳制后的烧录重试上限
    pub fn clamped_flash(&self) -> u32 {
        Self::clamp_one(self.flash)
    }
    /// 钳制后的验证重试上限
    pub fn clamped_verify(&self) -> u32 {
        Self::clamp_one(self.verify)
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            llm: LlmSettings {
                provider: "openai_compat".into(),
                base_url: String::new(),
                api_key: String::new(),
                model: String::new(),
                max_tokens: 8192,
            },
            automation: AutomationSettings {
                mode: "full".into(),
                // #24 默认 false：保持既有"自动烧录"实际行为不变（此前开关被忽略即等价 false）；
                // 用户开启后 pipeline 会在烧录前进入 FlashingConfirm 状态等待确认
                confirm_before_flash: false,
            },
            pin_blacklist: PinBlacklistSettings {
                extra_error: Vec::new(),
                extra_warn: Vec::new(),
            },
            toolchain: ToolchainSettings {
                arduino_cli_path: String::new(),
                default_baud: 115200,
                verbose_log: false,
            },
            // #71 默认不限（保持既有行为：不自动清理）
            data_management: DataManagementSettings {
                max_projects: 0,
                log_retention_days: 0,
            },
            // #69 默认各阶段 3 次重试，保持既有行为
            retry: RetrySettings::default(),
        }
    }
}

/// 设置文件路径：~/.talk2esp/settings.json
pub fn settings_path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".talk2esp").join("settings.json")
}

/// 加载设置（文件不存在则返回默认值）
pub fn load_settings() -> Settings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

/// 保存设置
pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// 判断 LLM 是否已配置（base_url + api_key + model 非空）
pub fn is_llm_configured(settings: &Settings) -> bool {
    !settings.llm.base_url.is_empty()
        && !settings.llm.api_key.is_empty()
        && !settings.llm.model.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings() {
        let s = Settings::default();
        assert_eq!(s.llm.provider, "openai_compat");
        assert_eq!(s.automation.mode, "full");
        // #24 默认 false，保持既有"自动烧录"实际行为
        assert!(!s.automation.confirm_before_flash);
        assert_eq!(s.toolchain.default_baud, 115200);
    }

    #[test]
    fn is_llm_configured_check() {
        let mut s = Settings::default();
        assert!(!is_llm_configured(&s));
        s.llm.base_url = "https://x".into();
        s.llm.api_key = "key".into();
        s.llm.model = "m".into();
        assert!(is_llm_configured(&s));
    }
}
