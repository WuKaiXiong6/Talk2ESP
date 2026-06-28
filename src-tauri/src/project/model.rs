// 文件路径：src-tauri/src/project/model.rs
// 文件作用：项目数据模型——元数据/对话记录/阶段日志/状态机
// 最后更新时间：2026-06-28-1015

use serde::{Deserialize, Serialize};

/// 流水线状态机（与 PRD 3.3 对齐）
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectState {
    /// 需求澄清中
    Drafting,
    /// 需求已确认
    Confirmed,
    /// 代码生成中
    Coding,
    /// 编译中
    Compiling,
    /// 烧录前确认
    FlashingConfirm,
    /// 烧录中
    Flashing,
    /// 验证中
    Verifying,
    /// 已归档（成功）
    Archived,
    /// 失败转人工
    Failed,
}

impl Default for ProjectState {
    fn default() -> Self {
        Self::Drafting
    }
}

impl ProjectState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Drafting => "drafting",
            Self::Confirmed => "confirmed",
            Self::Coding => "coding",
            Self::Compiling => "compiling",
            Self::FlashingConfirm => "flashing_confirm",
            Self::Flashing => "flashing",
            Self::Verifying => "verifying",
            Self::Archived => "archived",
            Self::Failed => "failed",
        }
    }
}

/// 自动化模式
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutoMode {
    /// 全自动
    Full,
    /// 分步确认
    Step,
}

impl Default for AutoMode {
    fn default() -> Self {
        Self::Full
    }
}

/// 项目元数据（project.json）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub chip: String,
    pub port: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub state: ProjectState,
    pub auto_mode: AutoMode,
    /// 引脚黑名单快照（创建时锁定）
    pub pin_blacklist_snapshot: PinBlacklistSnapshot,
    /// LLM 供应商名
    pub llm_provider: Option<String>,
    /// 各阶段重试计数
    pub retry_counts: RetryCounts,
}

/// 引脚黑名单快照
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PinBlacklistSnapshot {
    pub error: Vec<u32>,
    pub warn: Vec<u32>,
}

/// 各阶段重试计数（上限 3）
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RetryCounts {
    pub compile: u32,
    pub flash: u32,
    pub verify: u32,
}

impl RetryCounts {
    pub const MAX_RETRY: u32 = 3;

    pub fn inc_compile(&mut self) -> u32 {
        self.compile += 1;
        self.compile
    }
    pub fn inc_flash(&mut self) -> u32 {
        self.flash += 1;
        self.flash
    }
    pub fn inc_verify(&mut self) -> u32 {
        self.verify += 1;
        self.verify
    }
}

/// 对话消息（conversation.jsonl 每行一条）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ConversationMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    pub timestamp: String,
}

/// 阶段日志（logs/ 下每阶段一份）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StageLog {
    pub stage: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub success: bool,
    pub attempt: u32,
    pub output: String,
    pub error: Option<String>,
}
