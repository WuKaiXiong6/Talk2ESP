// 文件路径：src/components/RequirementExamples.tsx
// 文件作用：需求快捷示例——提供常见 ESP32 开发场景示例，点击即填入需求框，降低上手门槛
// 最后更新时间：2026-06-28-1240

import './RequirementExamples.css';

interface RequirementExamplesProps {
  /** 选中某示例时回调，参数为示例需求文本 */
  onSelect: (text: string) => void;
}

/// 内置示例需求库
const EXAMPLES: { label: string; text: string; icon: string }[] = [
  {
    label: 'LED 闪烁',
    icon: '💡',
    text: 'GPIO2 接 LED，每 500ms 交替亮灭，串口每秒输出当前状态（on/off）',
  },
  {
    label: '按键控制',
    icon: '🔘',
    text: 'GPIO4 接按键（INPUT_PULLUP），按下时 GPIO2 的 LED 点亮，松开熄灭，带 50ms 软件去抖',
  },
  {
    label: 'PWM 呼吸灯',
    icon: '🌊',
    text: 'GPIO15 接 LED，PWM 呼吸灯效果：占空比 0→255→0 循环，周期约 3 秒',
  },
  {
    label: '串口回显',
    icon: '🔁',
    text: '串口接收数据并原样回显，回显前缀 ECHO:，用于验证串口收发',
  },
  {
    label: 'I2C 扫描',
    icon: '🔍',
    text: 'I2C 总线扫描（SDA=21, SCL=22），列出所有应答设备地址，串口输出',
  },
  {
    label: '温度读取',
    icon: '🌡️',
    text: 'GPIO15 接 DHT11 温湿度传感器，每 2 秒读取一次，串口输出温度与湿度',
  },
];

/**
 * 需求快捷示例：横向滚动标签，点击填入需求框。
 */
export function RequirementExamples({ onSelect }: RequirementExamplesProps) {
  return (
    <div className="requirement-examples">
      <div className="requirement-examples-label">💡 快捷示例：</div>
      <div className="requirement-examples-list">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            className="requirement-example-chip"
            onClick={() => onSelect(ex.text)}
            title={ex.text}
          >
            <span aria-hidden>{ex.icon}</span>
            <span>{ex.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
