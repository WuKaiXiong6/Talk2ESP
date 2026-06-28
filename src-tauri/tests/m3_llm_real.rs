// 文件路径：tests/m3_llm_real.rs
// 文件作用：M3 AI适配层真实验证测试（需网络+真实LLM API Key）
// 最后更新时间：2026-06-28-1000

use talk2esp_lib::ai::openai_compat::OpenAiCompatProvider;
use talk2esp_lib::ai::{LlmProvider, RequirementSpec};

fn make_provider() -> OpenAiCompatProvider {
    OpenAiCompatProvider::from_env().expect("请配置 .env.local")
}

/// 验证 chat 基础对话
#[tokio::test]
async fn chat_basic() {
    let provider = make_provider();
    let reply = provider
        .chat(vec![talk2esp_lib::ai::ChatMessage::user("回复OK两字")])
        .await
        .expect("chat 失败");
    println!("chat 回复: {reply}");
    assert!(!reply.is_empty(), "回复不应为空");
}

/// 验证 generate_code：生成 LED 闪烁代码
#[tokio::test]
async fn generate_code_blink() {
    let provider = make_provider();
    let spec = RequirementSpec {
        project_name: "led_blink".into(),
        chip: "esp32s3".into(),
        peripherals: vec![talk2esp_lib::ai::PeripheralSpec {
            peripheral_type: "GPIO_OUT".into(),
            pin: 2,
            behavior: "GPIO2输出500ms方波".into(),
        }],
        expected_behavior: "GPIO2每500ms翻转一次电平".into(),
        test_harness_expectation: talk2esp_lib::ai::TestHarnessExpectation {
            cases: vec![talk2esp_lib::ai::TestCase {
                name: "led_toggle".into(),
                expect: "TEST:PASS led_toggle".into(),
            }],
        },
    };
    let code = provider.generate_code(&spec).await.expect("generate_code 失败");
    println!("主程序前200字: {}", &code.main_ino[..code.main_ino.len().min(200)]);
    assert!(!code.main_ino.is_empty(), "main_ino 不应为空");
    assert!(code.main_ino.contains("void setup") || code.main_ino.contains("setup()"), "应含 setup");
    assert!(!code.test_harness_ino.is_empty(), "test_harness_ino 不应为空");
}
