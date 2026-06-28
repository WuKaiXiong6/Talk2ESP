// 文件路径：src-tauri/src/settings/mod.rs
// 文件作用：用户设置模块，持久化到 ~/.talk2esp/settings.json，含 LLM/自动化/黑名单/工具链配置
// 最后更新时间：2026-06-28-1845

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
                confirm_before_flash: true,
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
        assert!(s.automation.confirm_before_flash);
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
