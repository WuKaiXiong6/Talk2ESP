# Talk2ESP 内置示例库

> 每个示例都是可直接编译烧录的 Arduino 程序，含测试桩标记输出。
> AI 生成代码时会参考这些示例的风格与测试桩协议。

## 示例清单

| 示例 | 引脚 | 说明 |
|---|---|---|
| [led_blink](led_blink/) | GPIO2 | LED 闪烁，最基础的 GPIO 输出 |
| [button_input](button_input/) | GPIO4 | 按键输入读取（内部上拉） |
| [i2c_sensor](i2c_sensor/) | SCL=22,SDA=21 | I2C 设备扫描与读取 |
| [spi_device](spi_device/) | SCK=18,MISO=35,MOSI=23,CS=5 | SPI 设备通信 |
| [pwm_fade](pwm_fade/) | GPIO15 | PWM 呼吸灯调光 |
| [serial_echo](serial_echo/) | USB | 串口回显（可读可发） |

## 测试桩协议

所有示例遵循 Talk2ESP 测试桩协议，运行时串口输出：
```
TEST:START <case_name>
TEST:PASS <case_name>      // 或 TEST:FAIL <case_name> <reason>
TEST:END
```

约定：
- 测试桩标记在 `loop()` 中持续循环输出（非 setup 一次）
- `setup()` 中 `Serial.begin(115200)` 后 `delay(500)` 给 USB CDC 重连留时间
- 避免使用引脚黑名单（ESP32-S3 的 GPIO26-32/45；ESP32-C3 的 GPIO12-17）
