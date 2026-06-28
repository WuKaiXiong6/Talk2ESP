// 文件路径：src-tauri/src/ai/openai_compat.rs
// 文件作用：OpenAI 兼容协议适配器，对接火山方舟等 OpenAI 兼容端点
// 最后更新时间：2026-06-28-1000

use crate::ai::prompts::{
    build_diagnose_messages, build_generate_code_messages, build_judge_messages,
};
use crate::ai::{
    ChatMessage, FixSuggestion, GeneratedCode, LlmProvider, RequirementSpec, Verdict,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// OpenAI 兼容适配器配置
#[derive(Clone, Debug)]
pub struct OpenAiCompatConfig {
    pub base_url: String,   // 如 https://ark.cn-beijing.volces.com/api/coding/v3
    pub api_key: String,
    pub model: String,
    pub max_tokens: u32,
}

impl OpenAiCompatConfig {
    /// 从环境变量读取（开发期读 .env.local；运行期读系统配置/密钥库）
    /// 字段：TALK2ESP_LLM_BASE_URL / TALK2ESP_LLM_API_KEY / TALK2ESP_LLM_MODEL
    pub fn from_env() -> Result<Self, String> {
        // 尝试加载 .env.local（开发期），失败不影响（运行期用系统环境变量）
        let _ = dotenvy::from_filename(".env.local");
        let base_url = std::env::var("TALK2ESP_LLM_BASE_URL")
            .map_err(|_| "未配置 TALK2ESP_LLM_BASE_URL".to_string())?;
        let api_key = std::env::var("TALK2ESP_LLM_API_KEY")
            .map_err(|_| "未配置 TALK2ESP_LLM_API_KEY".to_string())?;
        let model = std::env::var("TALK2ESP_LLM_MODEL")
            .map_err(|_| "未配置 TALK2ESP_LLM_MODEL".to_string())?;
        // glm-5.2 是推理模型，max_tokens 需较大（含 reasoning tokens）
        let max_tokens = std::env::var("TALK2ESP_LLM_MAX_TOKENS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(4096);
        Ok(Self { base_url, api_key, model, max_tokens })
    }
}

/// OpenAI 兼容 chat 请求体
#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessageSer<'a>>,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ChatMessageSer<'a> {
    role: &'a str,
    content: &'a str,
}

/// OpenAI 兼容 chat 响应体
#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: Option<String>,
}

/// OpenAI 兼容适配器
pub struct OpenAiCompatProvider {
    config: OpenAiCompatConfig,
    client: reqwest::Client,
}

impl OpenAiCompatProvider {
    pub fn new(config: OpenAiCompatConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    /// 从环境变量构造（便捷方法）
    pub fn from_env() -> Result<Self, String> {
        Ok(Self::new(OpenAiCompatConfig::from_env()?))
    }

    /// 底层 chat 调用，返回助手回复文本
    async fn chat_raw(&self, messages: Vec<ChatMessage>) -> Result<String, String> {
        let url = format!("{}/chat/completions", self.config.base_url.trim_end_matches('/'));
        let ser_messages: Vec<ChatMessageSer> = messages
            .iter()
            .map(|m| ChatMessageSer { role: &m.role, content: &m.content })
            .collect();
        let req = ChatRequest {
            model: &self.config.model,
            messages: ser_messages,
            max_tokens: self.config.max_tokens,
        };

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.config.api_key)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("LLM 请求失败: {e}"))?;

        let status = resp.status();
        let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
        if !status.is_success() {
            // 截断错误体避免泄露敏感信息
            let snippet = if text.len() > 500 { &text[..500] } else { &text };
            return Err(format!("LLM 返回 {status}: {snippet}"));
        }

        let chat_resp: ChatResponse =
            serde_json::from_str(&text).map_err(|e| format!("解析 LLM 响应失败: {e}; body={}", &text[..text.len().min(300)]))?;

        chat_resp
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or_else(|| "LLM 响应无 content".to_string())
    }

    /// 从 LLM 文本响应中提取 JSON（容忍被 ```json 包裹的情况）
    fn extract_json<T: serde::de::DeserializeOwned>(&self, text: &str) -> Result<T, String> {
        let trimmed = text.trim();
        // 去除可能的 ```json ... ``` 包裹
        let cleaned = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .map(|s| s.trim_end_matches("```").trim())
            .unwrap_or(trimmed);
        serde_json::from_str(cleaned)
            .map_err(|e| format!("解析 JSON 失败: {e}; 原文前300字: {}", &cleaned[..cleaned.len().min(300)]))
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatProvider {
    async fn chat(&self, messages: Vec<ChatMessage>) -> Result<String, String> {
        self.chat_raw(messages).await
    }

    async fn generate_code(&self, spec: &RequirementSpec) -> Result<GeneratedCode, String> {
        let messages = build_generate_code_messages(spec);
        let text = self.chat_raw(messages).await?;
        self.extract_json::<GeneratedCode>(&text)
    }

    async fn diagnose(&self, error: &str, context_code: &str) -> Result<FixSuggestion, String> {
        let messages = build_diagnose_messages(error, context_code);
        let text = self.chat_raw(messages).await?;
        self.extract_json::<FixSuggestion>(&text)
    }

    async fn judge(&self, serial_output: &str, expectation: &str) -> Result<Verdict, String> {
        let messages = build_judge_messages(serial_output, expectation);
        let text = self.chat_raw(messages).await?;
        self.extract_json::<Verdict>(&text)
    }
}
