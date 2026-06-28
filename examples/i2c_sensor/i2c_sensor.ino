// 示例：I2C 传感器读取（以 BMP280 气压传感器为例）
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：SCL=GPIO22, SDA=GPIO21（默认 I2C 引脚）
// 行为：扫描 I2C 设备，读取地址并输出测试桩
// 用途：Talk2ESP 内置示例

#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(21, 22);  // SDA, SCL
}

void loop() {
  Serial.println("TEST:START i2c_scan");
  bool found = false;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("I2C device at 0x");
      Serial.println(addr, HEX);
      found = true;
    }
  }
  if (found) {
    Serial.println("TEST:PASS i2c_scan");
  } else {
    Serial.println("TEST:FAIL i2c_scan no_device");
  }
  Serial.println("TEST:END");
  delay(2000);
}
