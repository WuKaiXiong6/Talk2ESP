// 文件路径：src-tauri/src/orchestrator/mod.rs
// 文件作用：流水线编排器模块入口，整合五层实现全自动状态机
// 最后更新时间：2026-06-29-0130

pub mod pipeline;

pub use pipeline::{run_pipeline, MaxRetry, PipelineConfig, PipelineEvent, PipelineOutcome};
