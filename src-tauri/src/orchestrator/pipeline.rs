// 文件路径：src-tauri/src/orchestrator/pipeline.rs
// 文件作用：流水线编排核心，状态机推进需求→代码→编译→烧录→验证，含失败重试
// 最后更新时间：2026-06-28-1310

use crate::ai::openai_compat::OpenAiCompatProvider;
use crate::ai::{GeneratedCode, LlmProvider, RequirementSpec, Verdict};
use crate::chips;
use crate::project::model::{Project, ProjectState, RetryCounts, StageLog};
use crate::project::ProjectStorage;
use crate::safety::{check_code_pins, scan_dangerous_ops};
use crate::toolchain::{compile_project, flash_project};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// 流水线事件（推送给前端，便于实时显示进度）
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", content = "data")]
pub enum PipelineEvent {
    /// 状态变更
    StateChanged { state: String },
    /// 阶段日志
    StageLog { stage: String, message: String },
    /// 进度百分比（0-100）与描述
    Progress { percent: u32, message: String },
    /// 编译/烧录流式输出
    ToolOutput { line: String },
    /// 生成的代码（供前端展示）
    CodeGenerated { main_ino: String, explanation: String },
    /// 重试
    Retry { stage: String, attempt: u32, max: u32, reason: String },
    /// 完成
    Done { success: bool, summary: String },
}

/// 流水线配置
#[derive(Clone, Debug)]
pub struct PipelineConfig {
    pub project_id: String,
    pub spec: RequirementSpec,
    pub port: String,
    /// 是否全自动（false=分步，需外部逐步推进；true=全自动跑到底）
    pub auto_mode: bool,
    /// #17 跳过 AI 生成阶段，直接使用用户编辑后的代码进入编译
    /// None=默认走 AI 生成（既有行为）；Some(code)=跳过生成，用此代码
    pub skip_coding_with_code: Option<String>,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        // 默认值保持既有行为：走 AI 生成
        Self {
            project_id: String::new(),
            spec: RequirementSpec {
                project_name: String::new(),
                chip: String::new(),
                peripherals: Vec::new(),
                expected_behavior: String::new(),
                test_harness_expectation: crate::ai::TestHarnessExpectation { cases: Vec::new() },
            },
            port: String::new(),
            auto_mode: true,
            skip_coding_with_code: None,
        }
    }
}

/// 流水线结果
#[derive(Serialize, Clone, Debug)]
pub struct PipelineOutcome {
    pub success: bool,
    pub final_state: String,
    pub verdict: Option<Verdict>,
    pub summary: String,
}

impl Default for PipelineOutcome {
    fn default() -> Self {
        Self {
            success: false,
            final_state: "failed".into(),
            verdict: None,
            summary: String::new(),
        }
    }
}

/// 运行全自动流水线（从 Coding 到 Verifying）
/// 前置条件：项目已 Confirmed（需求确认书已就绪）
/// on_event 回调接收流水线事件
pub async fn run_pipeline<F>(
    storage: Arc<Mutex<ProjectStorage>>,
    provider: Arc<OpenAiCompatProvider>,
    config: PipelineConfig,
    mut on_event: F,
) -> Result<PipelineOutcome, String>
where
    F: FnMut(PipelineEvent) + Send + 'static,
{
    let chip = config.spec.chip.clone();
    let descriptor = chips::load_descriptor(&chip)?;
    let project_name = config.spec.project_name.clone();

    let mut outcome = PipelineOutcome::default();
    let mut current_code: Option<GeneratedCode> = None;
    let mut retry = RetryCounts::default();
    let pipeline_start = std::time::Instant::now();

    // ========== Coding：AI 生成代码（或使用用户编辑后的代码）==========
    let stage_start = std::time::Instant::now();
    emit(&mut on_event, PipelineEvent::StateChanged { state: "coding".into() });
    emit(&mut on_event, PipelineEvent::Progress { percent: 10, message: "AI 正在理解需求并生成代码…".into() });

    // #17 若提供了用户编辑后的代码，则跳过 AI 生成，直接使用
    let generated = if let Some(edited_code) = &config.skip_coding_with_code {
        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "coding".into(),
            message: "使用用户编辑后的代码（跳过 AI 生成）".into(),
        });
        GeneratedCode {
            main_ino: edited_code.clone(),
            test_harness_ino: String::new(),
            explanation: "用户编辑后的代码".to_string(),
        }
    } else {
        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "coding".into(),
            message: "AI 生成代码中（glm-5.2 是推理模型，可能需要 20-40 秒思考）…".into(),
        });
        provider.generate_code(&config.spec).await.map_err(|e| {
            format!("代码生成失败: {e}")
        })?
    };
    emit(&mut on_event, PipelineEvent::StageLog {
        stage: "coding".into(),
        message: format!("代码就绪，耗时 {:.1}s", stage_start.elapsed().as_secs_f64()),
    });

    // 推送生成的代码与说明，让用户看到 AI 产出
    emit(&mut on_event, PipelineEvent::CodeGenerated {
        main_ino: generated.main_ino.clone(),
        explanation: generated.explanation.clone(),
    });
    emit(&mut on_event, PipelineEvent::Progress { percent: 30, message: "代码生成完成，进行安全校验…".into() });

    // 安全校验：引脚黑名单 + 危险扫描
    let pin_violations = check_code_pins(&generated.main_ino, &descriptor);
    if pin_violations.has_blocking {
        let err = format!(
            "代码生成违反引脚黑名单(阻断): {:?}",
            pin_violations.errors
        );
        emit(&mut on_event, PipelineEvent::Done { success: false, summary: err.clone() });
        return Ok(PipelineOutcome {
            success: false,
            final_state: "failed".into(),
            verdict: None,
            summary: err,
        });
    }
    let dangers = scan_dangerous_ops(&generated.main_ino);
    if !dangers.is_empty() {
        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "coding".into(),
            message: format!("检测到潜在危险操作(将提示用户): {:?}", dangers),
        });
    }

    // 保存代码到项目
    {
        let storage = storage.lock().await;
        storage.write_main_code(&config.project_id, &generated.main_ino)?;
        storage.write_test_harness(&config.project_id, &generated.test_harness_ino)?;
    }
    current_code = Some(generated);
    emit(&mut on_event, PipelineEvent::StageLog {
        stage: "coding".into(),
        message: "代码生成完成，进入编译".into(),
    });

    // ========== Compiling → Flashing → Verifying 循环（含重试） ==========
    loop {
        let code = current_code.as_ref().ok_or("无代码可编译")?;

        // 编译
        let stage_start = std::time::Instant::now();
        emit(&mut on_event, PipelineEvent::StateChanged { state: "compiling".into() });
        emit(&mut on_event, PipelineEvent::Progress { percent: 45, message: "调用 arduino-cli 编译代码…".into() });
        let compile_result = compile_sketch_for_project(&storage, &config.project_id, &project_name, &chip, &code.main_ino, &mut on_event).await?;
        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "compiling".into(),
            message: format!("编译{}，耗时 {:.1}s", if compile_result.success { "完成" } else { "失败" }, stage_start.elapsed().as_secs_f64()),
        });

        if !compile_result.success {
            let attempt = retry.inc_compile();
            if attempt > RetryCounts::MAX_RETRY {
                let summary = format!("编译失败，重试 {} 次后转人工。最后错误: {}", attempt, compile_result.error);
                return finalize_failed(storage, config.project_id, summary, outcome, &mut on_event).await;
            }
            emit(&mut on_event, PipelineEvent::Retry {
                stage: "compile".into(), attempt, max: RetryCounts::MAX_RETRY,
                reason: compile_result.error.clone(),
            });
            // AI 诊断修复
            match provider.diagnose(&compile_result.error, &code.main_ino).await {
                Ok(fix) => {
                    if let Some(fixed) = fix.fixed_main_ino {
                        emit(&mut on_event, PipelineEvent::StageLog {
                            stage: "coding".into(),
                            message: format!("AI 诊断后修复代码: {}", fix.analysis),
                        });
                        let storage = storage.lock().await;
                        storage.write_main_code(&config.project_id, &fixed)?;
                        drop(storage);
                        current_code = Some(GeneratedCode {
                            main_ino: fixed,
                            test_harness_ino: code.test_harness_ino.clone(),
                            explanation: code.explanation.clone(),
                        });
                    }
                    continue; // 重新编译
                }
                Err(e) => {
                    let summary = format!("AI 诊断失败: {e}");
                    return finalize_failed(storage, config.project_id, summary, outcome, &mut on_event).await;
                }
            }
        }

        // 烧录
        let stage_start = std::time::Instant::now();
        emit(&mut on_event, PipelineEvent::StateChanged { state: "flashing".into() });
        emit(&mut on_event, PipelineEvent::Progress { percent: 70, message: format!("通过 esptool 烧录到 {port}…", port = config.port) });
        let flash_result = flash_sketch_for_project(&storage, &config.project_id, &project_name, &chip, &config.port, &mut on_event).await?;
        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "flashing".into(),
            message: format!("烧录{}，耗时 {:.1}s", if flash_result.success { "完成" } else { "失败" }, stage_start.elapsed().as_secs_f64()),
        });

        if !flash_result.success {
            let attempt = retry.inc_flash();
            if attempt > RetryCounts::MAX_RETRY {
                let summary = format!("烧录失败，重试 {} 次后转人工: {}", attempt, flash_result.error);
                return finalize_failed(storage, config.project_id, summary, outcome, &mut on_event).await;
            }
            emit(&mut on_event, PipelineEvent::Retry {
                stage: "flash".into(), attempt, max: RetryCounts::MAX_RETRY,
                reason: flash_result.error.clone(),
            });
            // 烧录失败通常降波特率或检查连接，这里直接重试（arduino-cli upload 会重编译）
            continue;
        }

        // 验证：读串口 + 本地正则判定测试桩（不调 LLM，省 15-30s）
        let stage_start = std::time::Instant::now();
        emit(&mut on_event, PipelineEvent::StateChanged { state: "verifying".into() });
        emit(&mut on_event, PipelineEvent::Progress { percent: 85, message: "读取设备串口输出，匹配测试桩标记…".into() });
        let serial_output = read_serial_for_verify(&config.port, &mut on_event);

        let verdict = judge_locally(&serial_output, &config.spec);

        emit(&mut on_event, PipelineEvent::StageLog {
            stage: "verifying".into(),
            message: format!("判定: {} (匹配: {:?}, 失败: {:?})，耗时 {:.1}s", verdict.verdict, verdict.matched_cases, verdict.failed_cases, stage_start.elapsed().as_secs_f64()),
        });

        if verdict.verdict == "pass" {
            outcome.verdict = Some(verdict.clone());
            outcome.success = true;
            outcome.final_state = "archived".into();
            outcome.summary = format!("全自动流水线验证通过，总耗时 {:.1}s", pipeline_start.elapsed().as_secs_f64());
            update_project_state(&storage, &config.project_id, ProjectState::Archived).await;
            emit(&mut on_event, PipelineEvent::Progress { percent: 100, message: "完成".into() });
            emit(&mut on_event, PipelineEvent::Done { success: true, summary: outcome.summary.clone() });
            return Ok(outcome);
        }

        // 验证失败：AI 诊断修复重试
        let attempt = retry.inc_verify();
        if attempt > RetryCounts::MAX_RETRY {
            let summary = format!("验证失败，重试 {} 次后转人工: {}", attempt, verdict.reason);
            outcome.verdict = Some(verdict);
            return finalize_failed(storage, config.project_id, summary, outcome, &mut on_event).await;
        }
        emit(&mut on_event, PipelineEvent::Retry {
            stage: "verify".into(), attempt, max: RetryCounts::MAX_RETRY,
            reason: verdict.reason.clone(),
        });
        // AI 诊断修复代码，回到编译
        let error_msg = format!("验证失败: {} 串口输出: {}", verdict.reason, serial_output);
        match provider.diagnose(&error_msg, &code.main_ino).await {
            Ok(fix) => {
                if let Some(fixed) = fix.fixed_main_ino {
                    let storage = storage.lock().await;
                    storage.write_main_code(&config.project_id, &fixed)?;
                    drop(storage);
                    current_code = Some(GeneratedCode {
                        main_ino: fixed,
                        test_harness_ino: code.test_harness_ino.clone(),
                        explanation: code.explanation.clone(),
                    });
                }
                continue;
            }
            Err(e) => {
                let summary = format!("验证失败后 AI 诊断失败: {e}");
                return finalize_failed(storage, config.project_id, summary, outcome, &mut on_event).await;
            }
        }
    }
}

/// 编译项目草图（写入临时 .ino 与目录同名 + 调 compile_project）
async fn compile_sketch_for_project<F>(
    storage: &Arc<Mutex<ProjectStorage>>,
    project_id: &str,
    project_name: &str,
    chip: &str,
    code: &str,
    on_event: &mut F,
) -> Result<StageOutcome, String>
where
    F: FnMut(PipelineEvent) + Send + 'static,
{
    let descriptor = chips::load_descriptor(chip)?;
    let fqbn = descriptor.fqbn.clone();
    let sketch_dir = prepare_sketch_dir(storage, project_id, project_name, code).await?;

    let result = compile_project(&sketch_dir, &fqbn, |ev| {
        if let crate::toolchain::ToolEvent::Stdout(line) = ev {
            on_event(PipelineEvent::ToolOutput { line });
        }
    })?;

    write_stage_log(storage, project_id, "compile", result.success, &result.output).await;

    Ok(StageOutcome {
        success: result.success,
        error: if result.success { String::new() } else { result.output },
    })
}

/// 烧录项目草图
async fn flash_sketch_for_project<F>(
    storage: &Arc<Mutex<ProjectStorage>>,
    project_id: &str,
    project_name: &str,
    chip: &str,
    port: &str,
    on_event: &mut F,
) -> Result<StageOutcome, String>
where
    F: FnMut(PipelineEvent) + Send + 'static,
{
    let descriptor = chips::load_descriptor(chip)?;
    let fqbn = descriptor.fqbn.clone();
    let code = {
        let storage = storage.lock().await;
        storage.read_main_code(project_id)?
    };
    let sketch_dir = prepare_sketch_dir(storage, project_id, project_name, &code).await?;

    let result = flash_project(&sketch_dir, &fqbn, port, |ev| {
        if let crate::toolchain::ToolEvent::Stdout(line) = ev {
            on_event(PipelineEvent::ToolOutput { line });
        }
    })?;

    write_stage_log(storage, project_id, "flash", result.success, &result.output).await;

    Ok(StageOutcome {
        success: result.success,
        error: if result.success { String::new() } else { result.output },
    })
}

/// 准备草图目录：arduino-cli 要求 .ino 文件名与目录名一致
/// 把生成的代码写入 <tmp>/<project_name>/<project_name>.ino
async fn prepare_sketch_dir(
    storage: &Arc<Mutex<ProjectStorage>>,
    project_id: &str,
    project_name: &str,
    code: &str,
) -> Result<PathBuf, String> {
    let storage = storage.lock().await;
    let project_dir = storage.project_dir(project_id);
    let sketch_root = project_dir.join("build").join("sketch");
    let sketch_dir = sketch_root.join(sanitize(project_name));
    std::fs::create_dir_all(&sketch_dir).map_err(|e| e.to_string())?;
    std::fs::write(
        sketch_dir.join(format!("{}.ino", sanitize(project_name))),
        code,
    )
    .map_err(|e| e.to_string())?;
    Ok(sketch_dir)
}

/// 本地正则判定测试桩：匹配串口输出中的 TEST:PASS/FAIL 标记
/// 不调 LLM，省 15-30s。只有验证失败需诊断时才调 LLM
fn judge_locally(serial_output: &str, spec: &RequirementSpec) -> Verdict {
    use regex::Regex;
    let pass_re = Regex::new(r"TEST:PASS\s+(\S+)").unwrap();
    let fail_re = Regex::new(r"TEST:FAIL\s+(\S+)").unwrap();

    let mut matched: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    for cap in pass_re.captures_iter(serial_output) {
        if let Some(name) = cap.get(1) {
            let n = name.as_str().to_string();
            if !matched.contains(&n) {
                matched.push(n);
            }
        }
    }
    for cap in fail_re.captures_iter(serial_output) {
        if let Some(name) = cap.get(1) {
            let n = name.as_str().to_string();
            if !failed.contains(&n) {
                failed.push(n);
            }
        }
    }

    // 期望的用例名
    let expected: Vec<String> = spec
        .test_harness_expectation
        .cases
        .iter()
        .map(|c| c.name.clone())
        .collect();

    let all_expected_passed = expected.iter().all(|e| matched.contains(e));
    let no_failures = failed.is_empty();
    let has_any_pass = !matched.is_empty();

    let (verdict, reason) = if all_expected_passed && no_failures {
        ("pass".to_string(), format!("所有期望用例通过: {:?}", expected))
    } else if !has_any_pass {
        ("fail".to_string(), "未收到任何 TEST:PASS 标记，设备可能未正常运行或串口时序问题".to_string())
    } else if !no_failures {
        ("fail".to_string(), format!("存在失败的用例: {:?}", failed))
    } else {
        ("fail".to_string(), format!("部分期望用例未通过，已匹配: {:?}, 期望: {:?}", matched, expected))
    };

    Verdict {
        verdict,
        matched_cases: matched,
        failed_cases: failed,
        reason,
        ai_analysis: "本地正则匹配判定（未调用 LLM）".to_string(),
    }
}

/// 验证阶段读串口（烧录后设备复位输出测试桩标记）
/// S3 原生 USB(CDC) 复位后端口会断开重连，需重试打开端口并等待 CDC 重新枚举
fn read_serial_for_verify<F>(port: &str, on_event: &mut F) -> String
where
    F: FnMut(PipelineEvent) + Send + 'static,
{
    use std::io::Read;
    on_event(PipelineEvent::StageLog {
        stage: "verifying".into(),
        message: format!("读取 {port} 串口输出（等待设备复位+CDC重连）…"),
    });

    // 等待设备复位 + USB CDC 重新枚举（S3 原生 USB 复位后需 1-3 秒重连）
    std::thread::sleep(std::time::Duration::from_millis(3000));

    // 重试打开串口（最多 5 次，每次间隔 1 秒），应对 CDC 端口短暂不可用
    let mut serial = None;
    for attempt in 1..=5 {
        match serialport::new(port, 115200)
            .timeout(std::time::Duration::from_millis(500))
            .open()
        {
            Ok(s) => {
                serial = Some(s);
                break;
            }
            Err(e) => {
                on_event(PipelineEvent::StageLog {
                    stage: "verifying".into(),
                    message: format!("打开 {port} 失败(尝试 {attempt}/5): {e}"),
                });
                std::thread::sleep(std::time::Duration::from_millis(1000));
            }
        }
    }
    let mut serial = match serial {
        Some(s) => s,
        None => {
            on_event(PipelineEvent::StageLog {
                stage: "verifying".into(),
                message: format!("无法打开 {port}，验证串口为空"),
            });
            return String::new();
        }
    };

    // esptool 烧录末尾已执行 Hard reset，设备已从头运行；
    // 此处再等待 1 秒确保测试桩输出稳定
    std::thread::sleep(std::time::Duration::from_millis(1000));

    let mut output = String::new();
    let mut buf = [0u8; 256];
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(8) {
        match serial.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                on_event(PipelineEvent::ToolOutput { line: text.trim().to_string() });
                output.push_str(&text);
                // 收到 TEST:END 或足够数据即可提前结束
                if output.contains("TEST:END") {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(_) => break,
        }
    }
    output
}

async fn write_stage_log(
    storage: &Arc<Mutex<ProjectStorage>>,
    project_id: &str,
    stage: &str,
    success: bool,
    output: &str,
) {
    let log = StageLog {
        stage: stage.to_string(),
        started_at: now_iso().to_string(),
        finished_at: Some(now_iso().to_string()),
        success,
        attempt: 1,
        output: output.to_string(),
        error: if success { None } else { Some(output.to_string()) },
    };
    let storage = storage.lock().await;
    let _ = storage.write_stage_log(project_id, &log);
}

async fn update_project_state(
    storage: &Arc<Mutex<ProjectStorage>>,
    project_id: &str,
    state: ProjectState,
) {
    let storage = storage.lock().await;
    if let Ok(mut project) = storage.load_project(project_id) {
        project.state = state;
        project.updated_at = now_iso().to_string();
        let _ = storage.save_project(&project);
    }
}

async fn finalize_failed<F>(
    storage: Arc<Mutex<ProjectStorage>>,
    project_id: String,
    summary: String,
    mut outcome: PipelineOutcome,
    on_event: &mut F,
) -> Result<PipelineOutcome, String>
where
    F: FnMut(PipelineEvent) + Send + 'static,
{
    outcome.success = false;
    outcome.final_state = "failed".into();
    outcome.summary = summary.clone();
    update_project_state(&storage, &project_id, ProjectState::Failed).await;
    on_event(PipelineEvent::Done { success: false, summary });
    Ok(outcome)
}

struct StageOutcome {
    success: bool,
    error: String,
}

fn emit<F: FnMut(PipelineEvent)>(on_event: &mut F, event: PipelineEvent) {
    on_event(event);
}

fn sanitize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_')
        .collect::<String>()
        .to_lowercase()
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let beijing = secs + 8 * 3600;
    let days = beijing / 86400;
    let rem = beijing % 86400;
    let h = rem / 3600;
    let m = (rem % 3600) / 60;
    let s = rem % 60;
    let (y, mo, d) = days_to_ymd(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}+08:00")
}

fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    let mut y = 1970i64;
    let mut d = days;
    loop {
        let yd = if is_leap(y) { 366 } else { 365 };
        if d < yd { break; }
        d -= yd;
        y += 1;
    }
    let months = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 0u32;
    let mut dd = d as u32;
    while mo < 12 {
        let md = if mo == 1 && is_leap(y) { 29 } else { months[mo as usize] };
        if dd < md { break; }
        dd -= md;
        mo += 1;
    }
    (y, mo + 1, dd + 1)
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}
