// 文件路径：tests/m8_e2e_com8.rs
// 文件作用：M8 双板自测——在 COM8(第二块S3)上独立跑通全自动闭环，验证多设备支持
// 最后更新时间：2026-06-28-1041

use std::sync::{Arc, Mutex};
use talk2esp_lib::ai::openai_compat::OpenAiCompatProvider;
use talk2esp_lib::ai::RequirementSpec;
use talk2esp_lib::orchestrator::{run_pipeline, PipelineConfig, PipelineEvent};
use talk2esp_lib::project::ProjectStorage;

/// 在 COM8（第二块 ESP32-S3）上跑通全自动闭环
/// 与 M6 的 COM4 测试互为印证，验证多设备支持
#[tokio::test]
async fn e2e_blink_pipeline_com8() {
    if serialport::new("COM8", 115200).open().is_err() {
        eprintln!("跳过：COM8 不可用");
        return;
    }

    let provider = Arc::new(OpenAiCompatProvider::from_env().expect("请配置 .env.local"));
    let storage = Arc::new(tokio::sync::Mutex::new(ProjectStorage::from_default()));

    let project = {
        let s = storage.lock().await;
        s.create_project(
            "e2e_blink_com8",
            "esp32s3",
            talk2esp_lib::project::model::PinBlacklistSnapshot::default(),
            Some("openai_compat".into()),
        )
        .expect("创建项目失败")
    };

    // 需求：GPIO48 闪烁（用不同引脚区分 COM4 的 GPIO2 测试）
    let spec = RequirementSpec {
        project_name: "e2e_blink_com8".into(),
        chip: "esp32s3".into(),
        peripherals: vec![talk2esp_lib::ai::PeripheralSpec {
            peripheral_type: "GPIO_OUT".into(),
            pin: 48,
            behavior: "GPIO48每500ms翻转".into(),
        }],
        expected_behavior: "GPIO48闪烁，串口输出 TEST:START blink / TEST:PASS blink / TEST:END".into(),
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
        port: "COM8".into(),
        auto_mode: true,
    };

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

    println!("COM8 最终状态: {} 成功: {}", outcome.final_state, outcome.success);
    println!("摘要: {}", outcome.summary);

    assert!(outcome.success, "COM8 流水线应成功完成: {}", outcome.summary);

    let s = storage.lock().await;
    let _ = s.delete_project(&project.id);
}
