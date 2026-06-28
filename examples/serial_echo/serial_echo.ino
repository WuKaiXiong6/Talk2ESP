// 示例：串口回显
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：无（使用原生 USB 串口）
// 行为：收到串口数据后原样回显（前缀 ECHO:），并周期输出测试桩
// 用途：Talk2ESP 内置示例，验证串口可读可发

String inputBuffer = "";

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  // 处理接收
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      Serial.print("ECHO:");
      Serial.println(inputBuffer);
      inputBuffer = "";
    } else if (c != '\r') {
      inputBuffer += c;
    }
  }

  // 周期输出测试桩
  Serial.println("TEST:START serial_echo");
  Serial.println("TEST:PASS serial_echo");
  Serial.println("TEST:END");
  delay(2000);
}
