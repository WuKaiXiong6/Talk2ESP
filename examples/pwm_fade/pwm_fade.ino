// 示例：PWM 调光（LED 呼吸灯）
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：GPIO15（LED，安全通用引脚）
// 行为：PWM 占空比从 0 渐变到 255 再回 0，输出测试桩
// 用途：Talk2ESP 内置示例

const int ledPin = 15;
const int freq = 5000;
const int ledChannel = 0;
const int resolution = 8;

void setup() {
  Serial.begin(115200);
  delay(500);
  ledcAttachChannel(ledPin, freq, resolution, ledChannel);
}

void loop() {
  // 渐亮
  for (int duty = 0; duty <= 255; duty += 5) {
    ledcWrite(ledChannel, duty);
    delay(20);
  }
  // 渐灭
  for (int duty = 255; duty >= 0; duty -= 5) {
    ledcWrite(ledChannel, duty);
    delay(20);
  }
  Serial.println("TEST:START pwm_fade");
  Serial.println("TEST:PASS pwm_fade");
  Serial.println("TEST:END");
}
