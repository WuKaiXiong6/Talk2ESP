// 文件路径：src-tauri/src/ai/mod.rs
// 文件作用：AI 适配层模块入口，定义统一 LlmProvider trait 与数据结构
// 最后更新时间：2026-06-28-1000

pub mod openai_compat;
pub mod prompts;

use serde::{Deserialize, Serialize};

/// 对话消息
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: "system".into(), content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user".into(), content: content.into() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: content.into() }
    }
}

/// 需求确认书（结构化）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RequirementSpec {
    pub project_name: String,
    pub chip: String,
    pub peripherals: Vec<PeripheralSpec>,
    pub expected_behavior: String,
    pub test_harness_expectation: TestHarnessExpectation,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PeripheralSpec {
    #[serde(rename = "type")]
    pub peripheral_type: String,
    pub pin: u32,
    pub behavior: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TestHarnessExpectation {
    pub cases: Vec<TestCase>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TestCase {
    pub name: String,
    pub expect: String,
}

/// AI 生成的代码（主程序 + 测试桩）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GeneratedCode {
    pub main_ino: String,
    pub test_harness_ino: String,
    pub explanation: String,
}

/// 验证判定结果
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Verdict {
    pub verdict: String, // "pass" | "fail"
    pub matched_cases: Vec<String>,
    pub failed_cases: Vec<String>,
    pub reason: String,
    pub ai_analysis: String,
}

/// 错误诊断修复建议
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FixSuggestion {
    pub analysis: String,
    pub fixed_main_ino: Option<String>,
    pub fixed_test_harness_ino: Option<String>,
    pub parameter_changes: Option<String>,
}

/// LLM 供应商统一接口
/// AI 仅产出数据，不触发任何工具链动作（编排器负责调用）
#[async_trait::async_trait]
pub trait LlmProvider: Send + Sync {
    /// 通用对话，返回助手回复文本
    async fn chat(&self, messages: Vec<ChatMessage>) -> Result<String, String>;

    /// 根据需求确认书生成 Arduino 代码 + 测试桩
    async fn generate_code(&self, spec: &RequirementSpec) -> Result<GeneratedCode, String>;

    /// 诊断编译/烧录/验证错误，给出修复建议
    async fn diagnose(&self, error: &str, context_code: &str) -> Result<FixSuggestion, String>;

    /// 根据串口输出与预期判定验证结果
    async fn judge(&self, serial_output: &str, expectation: &str) -> Result<Verdict, String>;
}
