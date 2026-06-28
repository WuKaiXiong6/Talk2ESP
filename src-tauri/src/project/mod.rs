// 文件路径：src-tauri/src/project/mod.rs
// 文件作用：项目/存储层模块入口，管理项目元数据与文件夹持久化
// 最后更新时间：2026-06-28-1015

pub mod model;
pub mod storage;

pub use model::{ConversationMessage, Project, ProjectState, StageLog};
pub use storage::ProjectStorage;
