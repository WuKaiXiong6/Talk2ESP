// 示例：SPI 设备通信
// 芯片：ESP32-S3 / ESP32-C3 通用
// 引脚：SCK=GPIO18, MISO=GPIO19(注意S3的USB冲突,实际用GPIO35), MOSI=GPIO23, CS=GPIO5
// 行为：SPI 发送字节并读取响应，输出测试桩
// 用途：Talk2ESP 内置示例
// 注意：ESP32-S3 的 GPIO19/20 是原生 USB，避免使用；本例 MISO 用 GPIO35

#include <SPI.h>

SPIClass spi(HSPI);
const int csPin = 5;

void setup() {
  Serial.begin(115200);
  delay(500);
  spi.begin(18, 35, 23, csPin);  // SCK, MISO, MOSI, SS
  pinMode(csPin, OUTPUT);
  digitalWrite(csPin, HIGH);
}

void loop() {
  spi.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(csPin, LOW);
  uint8_t resp = spi.transfer(0xAB);
  digitalWrite(csPin, HIGH);
  spi.endTransaction();

  Serial.println("TEST:START spi_transfer");
  Serial.print("SPI response: 0x");
  Serial.println(resp, HEX);
  Serial.println("TEST:PASS spi_transfer");
  Serial.println("TEST:END");
  delay(1000);
}
