// 文件路径：src/types/port.ts
// 文件作用：串口信息前端类型定义，与 Rust PortInfo 对齐

export interface PortInfo {
  name: string;
  vid: number | null;
  pid: number | null;
  product: string | null;
  manufacturer: string | null;
  serial_number: string | null;
}
