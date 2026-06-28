// 示例：按键输入
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：GPIO4（按键输入，内部上拉）
// 行为：读取按键状态，按下时串口输出测试桩标记
// 用途：Talk2ESP 内置示例

void setup() {
  Serial.begin(115200);
  delay(500);
  pinMode(4, INPUT_PULLUP);
}

void loop() {
  if (digitalRead(4) == LOW) {  // 按下（低电平）
    Serial.println("TEST:START button_pressed");
    Serial.println("TEST:PASS button_pressed");
    Serial.println("TEST:END");
    delay(200);  // 消抖
  }
  delay(50);
}
