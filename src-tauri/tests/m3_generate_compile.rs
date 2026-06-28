// 文件路径：tests/m3_generate_compile.rs
// 文件作用：验证AI生成代码可真实编译（M3与M2衔接验证）
// 最后更新时间：2026-06-28-1007

use talk2esp_lib::ai::openai_compat::OpenAiCompatProvider;
use talk2esp_lib::ai::{LlmProvider, RequirementSpec};
use talk2esp_lib::toolchain::compile_project;

#[tokio::test]
async fn generate_then_compile() {
    let provider = OpenAiCompatProvider::from_env().expect("请配置 .env.local");

    // 需求：GPIO2 闪烁 + 串口输出测试桩
    let spec = RequirementSpec {
        project_name: "blink_test".into(),
        chip: "esp32s3".into(),
        peripherals: vec![talk2esp_lib::ai::PeripheralSpec {
            peripheral_type: "GPIO_OUT".into(),
            pin: 2,
            behavior: "GPIO2每500ms翻转".into(),
        }],
        expected_behavior: "GPIO2闪烁，串口输出TEST:PASS".into(),
        test_harness_expectation: talk2esp_lib::ai::TestHarnessExpectation {
            cases: vec![talk2esp_lib::ai::TestCase {
                name: "led_toggle".into(),
                expect: "TEST:PASS led_toggle".into(),
            }],
        },
    };

    let code = provider.generate_code(&spec).await.expect("生成代码失败");

    // 写入临时草图目录并编译（arduino-cli 要求 .ino 文件名与目录名一致）
    let sketch_name = "blink_test";
    let tmp = std::env::temp_dir().join(sketch_name);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join(format!("{sketch_name}.ino")), &code.main_ino).unwrap();

    let result = compile_project(&tmp, "esp32:esp32:esp32s3", |_| {})
        .expect("调用编译失败");

    println!("编译 success={}, exit={:?}", result.success, result.exit_code);
    if !result.success {
        println!("编译输出: {}", &result.output[..result.output.len().min(500)]);
    }
    assert!(result.success, "AI生成代码应能编译通过");

    std::fs::remove_dir_all(&tmp).ok();
}
