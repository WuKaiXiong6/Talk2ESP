// 示例：LED 闪烁
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：GPIO2（安全通用引脚）
// 行为：GPIO2 每 500ms 翻转，串口输出测试桩标记
// 用途：Talk2ESP 内置示例，AI 生成代码时可参考

void setup() {
  Serial.begin(115200);
  delay(500);  // 给 USB CDC 重新枚举留时间
  pinMode(2, OUTPUT);
}

void loop() {
  digitalWrite(2, HIGH);
  Serial.println("TEST:START led_blink");
  Serial.println("TEST:PASS led_blink");
  Serial.println("TEST:END");
  delay(500);
  digitalWrite(2, LOW);
  delay(500);
}
