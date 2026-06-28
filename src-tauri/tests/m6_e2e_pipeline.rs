// 文件路径：tests/m6_e2e_pipeline.rs
// 文件作用：M6 编排器端到端验证——真实LLM生成代码→编译→烧录COM4→读串口→AI判定
// 最后更新时间：2026-06-28-1018

use std::sync::{Arc, Mutex};
use talk2esp_lib::ai::openai_compat::OpenAiCompatProvider;
use talk2esp_lib::ai::RequirementSpec;
use talk2esp_lib::orchestrator::{run_pipeline, PipelineConfig, PipelineEvent};
use talk2esp_lib::project::ProjectStorage;

/// 端到端：需求"GPIO2闪烁+串口输出TEST:PASS"→全自动流水线
/// 验证 M6 编排器整合五层完成闭环
#[tokio::test]
async fn e2e_blink_pipeline_com4() {
    // 确认 COM4 设备可用
    if serialport::new("COM4", 115200).open().is_err() {
        eprintln!("跳过：COM4 不可用");
        return;
    }

    let provider = Arc::new(OpenAiCompatProvider::from_env().expect("请配置 .env.local"));
    let storage = Arc::new(tokio::sync::Mutex::new(ProjectStorage::from_default()));

    // 创建项目
    let project = {
        let s = storage.lock().await;
        s.create_project(
            "e2e_blink",
            "esp32s3",
            talk2esp_lib::project::model::PinBlacklistSnapshot::default(),
            Some("openai_compat".into()),
        )
        .expect("创建项目失败")
    };

    // 需求确认书：GPIO2 闪烁 + 串口测试桩
    let spec = RequirementSpec {
        project_name: "e2e_blink".into(),
        chip: "esp32s3".into(),
        peripherals: vec![talk2esp_lib::ai::PeripheralSpec {
            peripheral_type: "GPIO_OUT".into(),
            pin: 2,
            behavior: "GPIO2每500ms翻转".into(),
        }],
        expected_behavior: "GPIO2闪烁，串口输出 TEST:START blink / TEST:PASS blink / TEST:END".into(),
        test_harness_expectation: talk2esp_lib::ai::TestHarnessExpectation {
            cases: vec![talk2esp_lib::ai::TestCase {
                name: "blink".into(),
                expect: "TEST:PASS blink".into(),
            }],
        },
    };

    let config = PipelineConfig {
        project_id: project.id.clone(),
        spec,
        port: "COM4".into(),
        auto_mode: true,
    };

    // 收集事件用于断言
    let events: Arc<Mutex<Vec<PipelineEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let events_clone = events.clone();

    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        run_pipeline(storage.clone(), provider, config, move |event| {
            events_clone.lock().unwrap().push(event);
        }),
    )
    .await
    .expect("流水线超时(300s)")
    .expect("流水线执行出错");

    println!("最终状态: {}", outcome.final_state);
    println!("成功: {}", outcome.success);
    println!("摘要: {}", outcome.summary);
    if let Some(v) = &outcome.verdict {
        println!("判定: {} {}", v.verdict, v.reason);
    }

    // 打印关键事件
    let evs = events.lock().unwrap();
    for e in evs.iter() {
        println!("事件: {:?}", e);
    }

    assert!(outcome.success, "流水线应成功完成: {}", outcome.summary);

    // 清理项目
    let s = storage.lock().await;
    let _ = s.delete_project(&project.id);
}
