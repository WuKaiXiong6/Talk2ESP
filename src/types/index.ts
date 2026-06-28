// 文件路径：src/types/index.ts
// 文件作用：前端类型定义，与 Rust 后端结构对齐
// 最后更新时间：2026-06-28-1037

export interface PortInfo {
  name: string;
  vid: number | null;
  pid: number | null;
  product: string | null;
  manufacturer: string | null;
  serial_number: string | null;
}

export interface DeviceInfo {
  port: string;
  vid: number | null;
  pid: number | null;
  product: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  chip: string | null;
  mac: string | null;
  flash_size: string | null;
  detected: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface PeripheralSpec {
  type: string;
  pin: number;
  behavior: string;
}

export interface TestCase {
  name: string;
  expect: string;
}

export interface RequirementSpec {
  project_name: string;
  chip: string;
  peripherals: PeripheralSpec[];
  expected_behavior: string;
  test_harness_expectation: { cases: TestCase[] };
}

export interface GeneratedCode {
  main_ino: string;
  test_harness_ino: string;
  explanation: string;
}

export interface Verdict {
  verdict: string;
  matched_cases: string[];
  failed_cases: string[];
  reason: string;
  ai_analysis: string;
}

export interface PinViolation {
  pin: number;
  level: string;
  note: string | null;
  context: string;
}

export interface PinViolations {
  errors: PinViolation[];
  warnings: PinViolation[];
  has_blocking: boolean;
}

export interface Project {
  id: string;
  name: string;
  chip: string;
  port: string | null;
  created_at: string;
  updated_at: string;
  state: string;
  auto_mode: string;
  pin_blacklist_snapshot: { error: number[]; warn: number[] };
  llm_provider: string | null;
  retry_counts: { compile: number; flash: number; verify: number };
}

export interface ConversationMessage {
  role: string;
  content: string;
  timestamp: string;
}

export type PipelineEvent =
  | { kind: 'StateChanged'; data: { state: string } }
  | { kind: 'StageLog'; data: { stage: string; message: string } }
  | { kind: 'ToolOutput'; data: { line: string } }
  | { kind: 'Retry'; data: { stage: string; attempt: number; max: number; reason: string } }
  | { kind: 'Done'; data: { success: boolean; summary: string } };

export interface PipelineOutcome {
  success: boolean;
  final_state: string;
  verdict: Verdict | null;
  summary: string;
}
