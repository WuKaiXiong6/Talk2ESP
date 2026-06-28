// 文件路径：src-tauri/src/ai/prompts.rs
// 文件作用：各 AI 调用阶段的 Prompt 模板
// 最后更新时间：2026-06-28-1000

use crate::ai::{ChatMessage, RequirementSpec};

/// 系统人设：Talk2ESP 的 Arduino 代码生成助手
pub const SYSTEM_PROMPT: &str = r#"你是 Talk2ESP 的嵌入式开发助手，专精 ESP32（S3/C3）的 Arduino 框架开发。
你的职责：
1. 理解用户自然语言需求，生成可直接编译烧录的 Arduino 原生代码（使用 Wire/SPI/analogWrite 等标准库）；
2. 测试桩标记必须在 loop() 中持续循环输出（不要只在 setup 输出一次），约定格式：TEST:START <case>、TEST:PASS <case>、TEST:FAIL <case> <reason>、TEST:END；
3. setup() 中 Serial.begin 后须 delay(500)，给 ESP32-S3 原生 USB CDC 重新枚举留时间，避免输出丢失；
4. 遵循引脚黑名单：不得使用 Flash/PSRAM 物理引脚、VDD_SPI 电压选择脚（ESP32-S3 的 GPIO26-32/45；ESP32-C3 的 GPIO12-17）；对 Strapping/USB/JTAG 引脚需谨慎并注释说明；
5. 涉及 JSON 输出时，必须返回严格合法的 JSON，不要包裹 markdown 代码块标记，不要附加解释文字。"#;

/// 构建代码生成的消息序列
pub fn build_generate_code_messages(spec: &RequirementSpec) -> Vec<ChatMessage> {
    let spec_json = serde_json::to_string_pretty(spec).unwrap_or_default();
    let user = format!(
        r#"请根据以下需求确认书生成 Arduino 代码。返回严格的 JSON，格式如下（不要 markdown 包裹）：
{{
  "main_ino": "完整的 .ino 主程序代码字符串",
  "test_harness_ino": "测试桩 .ino 代码字符串，运行时输出 TEST:START/PASS/FAIL/END 标记",
  "explanation": "对代码的简要说明"
}}

需求确认书：
{spec_json}

要求：
- 代码针对芯片 {chip}，使用 Arduino 标准库；
- 引脚使用须避开黑名单（{chip} 的 Flash/PSRAM/VDD_SPI 引脚）；
- 串口波特率统一 115200；
- **main_ino 必须在 loop() 中持续（循环）输出测试桩标记**，与 test_harness_expectation.cases 对应：每轮输出 TEST:START <case>、TEST:PASS <case>、TEST:END，确保验证阶段读串口能稳定捕获（不要只在 setup 输出一次）；
- **main_ino 的 setup() 开头须 Serial.begin(115200) 后 delay(500)**，给 ESP32-S3 原生 USB CDC 重新枚举留时间；
- test_harness_ino 是独立测试程序，同样在 loop 循环输出测试桩；
- main_ino 与 test_harness_ino 是两个独立程序（验证阶段实际烧录 main_ino）。"#,
        chip = spec.chip
    );
    vec![ChatMessage::system(SYSTEM_PROMPT), ChatMessage::user(user)]
}

/// 构建错误诊断的消息序列
pub fn build_diagnose_messages(error: &str, context_code: &str) -> Vec<ChatMessage> {
    let user = format!(
        r#"以下 Arduino 编译/烧录/验证过程出错，请分析根因并给出修复。返回严格 JSON（不要 markdown 包裹）：
{{
  "analysis": "错误根因分析",
  "fixed_main_ino": "修复后的主程序代码（无修改则 null）",
  "fixed_test_harness_ino": "修复后的测试桩代码（无修改则 null）",
  "parameter_changes": "需调整的参数说明（如波特率/引脚，无则 null）"
}}

错误信息：
{error}

相关代码：
{context_code}"#
    );
    vec![ChatMessage::system(SYSTEM_PROMPT), ChatMessage::user(user)]
}

/// 构建验证判定的消息序列
pub fn build_judge_messages(serial_output: &str, expectation: &str) -> Vec<ChatMessage> {
    let user = format!(
        r#"请根据串口输出判定验证是否通过。返回严格 JSON（不要 markdown 包裹）：
{{
  "verdict": "pass 或 fail",
  "matched_cases": ["通过的用例名"],
  "failed_cases": ["失败的用例名"],
  "reason": "判定理由",
  "ai_analysis": "对运行现象的简要分析"
}}

预期行为：
{expectation}

实际串口输出：
{serial_output}

判定规则：串口输出中应包含预期的 TEST:PASS 标记，且无 TEST:FAIL。若全部预期用例 PASS 则 verdict=pass。"#
    );
    vec![ChatMessage::system(SYSTEM_PROMPT), ChatMessage::user(user)]
}
