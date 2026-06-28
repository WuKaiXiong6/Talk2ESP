// 文件路径：src/views/DevelopView.tsx
// 文件作用：开发视图——设备选择/需求输入/一键全自动流水线/进度展示/代码展示/过程日志
// 最后更新时间：2026-06-28-1230

import type { RefObject } from 'react';
import type {
  DeviceInfo, PipelineOutcome, ConversationMessage,
} from '../types';
import { Button, Badge, StatusDot } from '../components/ui';
export interface DevelopViewProps {
  devices: DeviceInfo[];
  selectedPort: string;
  selectedChip: string;
  chips: string[];
  requirement: string;
  running: boolean;
  currentState: string;
  progress: { percent: number; message: string };
  generatedCode: { main_ino: string; explanation: string } | null;
  llmConfigured: boolean;
  chatHistory: ConversationMessage[];
  logs: string[];
  outcome: PipelineOutcome | null;
  logEndRef: RefObject<HTMLDivElement | null>;
  onRefreshDevices: () => void;
  onPort: (p: string) => void;
  onChip: (c: string) => void;
  onRequirement: (r: string) => void;
  onChat: () => void;
  onRun: () => void;
  onStop: () => void;
  onGoSettings: () => void;
}

/// 流水线阶段标签映射
const STATE_LABEL: Record<string, string> = {
  coding: '🧠 AI 生成代码',
  compiling: '⚙️ 编译中',
  flashing: '📡 烧录中',
  verifying: '🔍 验证中',
  archived: '✅ 完成',
  failed: '❌ 失败',
};

export function DevelopView(props: DevelopViewProps) {
  const {
    devices, selectedPort, selectedChip, chips, requirement, running, currentState,
    progress, generatedCode, llmConfigured, chatHistory, logs, outcome, logEndRef,
    onRefreshDevices, onPort, onChip, onRequirement, onChat, onRun, onStop, onGoSettings,
  } = props;

  return (
    <div className="develop-view">
      {!llmConfigured && (
        <div className="config-warn" role="alert">
          <span>⚠️ 尚未配置 LLM，无法进行 AI 开发。</span>
          <Button variant="ghost" size="sm" onClick={onGoSettings}>前往设置 →</Button>
        </div>
      )}
      <div className="control-panel ui-card">
        <div className="control-row">
          <label>设备:</label>
          <select value={selectedPort} onChange={(e) => onPort(e.target.value)} disabled={running}>
            <option value="">选择串口…</option>
            {devices.map((d) => (
              <option key={d.port} value={d.port}>
                {d.port} {d.chip ? `(${d.chip})` : ''} {d.detected ? '✓' : ''}
              </option>
            ))}
          </select>
          <label>芯片:</label>
          <select value={selectedChip} onChange={(e) => onChip(e.target.value)} disabled={running}>
            {chips.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={onRefreshDevices} disabled={running}>
            刷新设备
          </Button>
        </div>

        <div className="requirement-box">
          <label>描述你的需求（自然语言）:</label>
          <textarea
            value={requirement}
            onChange={(e) => onRequirement(e.target.value)}
            placeholder="例如：GPIO2 接 LED，每 500ms 闪烁一次，串口输出闪烁状态"
            rows={4}
            disabled={running}
          />
          <div className="btn-row">
            <Button variant="secondary" onClick={onChat} disabled={running || !requirement.trim()}>
              与 AI 对话澄清
            </Button>
            <Button variant="primary" onClick={onRun} disabled={running || !requirement.trim() || !selectedPort}>
              {running ? '运行中…' : '🚀 一键全自动开发'}
            </Button>
            {running && (
              <Button variant="danger" onClick={onStop}>⏹ 终止</Button>
            )}
          </div>
        </div>

        {(running || progress.percent > 0) && (
          <div className="progress-section">
            <div className="progress-header">
              {running && (
                <StatusDot state="running" label={currentState ? (STATE_LABEL[currentState] ?? currentState) : '运行中'} />
              )}
              <span className="progress-percent">{progress.percent}%</span>
            </div>
            <div className="progress-bar">
              {/* #15 进度条分阶段着色：coding蓝/compiling橙/flashing紫/verifying青/成功绿/失败红 */}
              <div
                className={`progress-fill progress-${currentState || (outcome?.success ? 'archived' : outcome ? 'failed' : 'idle')}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-message">{progress.message}</div>
          </div>
        )}

        {generatedCode && (
          <div className="code-section">
            <h4>
              AI 生成的代码
              {generatedCode.explanation && <span className="code-explain">— {generatedCode.explanation}</span>}
            </h4>
            <pre className="code-block">{generatedCode.main_ino}</pre>
          </div>
        )}
      </div>

      <div className="chat-log ui-card">
        <h3>过程日志</h3>
        <div className="messages">
          {chatHistory.map((m, i) => (
            <div key={`msg-${i}`} className={`msg msg-${m.role}`}>
              <span className="msg-role">{m.role === 'user' ? '我' : 'AI'}:</span>
              <span className="msg-content">{m.content}</span>
            </div>
          ))}
          {logs.map((line, i) => (
            <div key={`log-${i}`} className="log-line">{line}</div>
          ))}
          {outcome && (
            <div className={`outcome ${outcome.success ? 'success' : 'fail'}`}>
              {outcome.success ? '✅' : '❌'} {outcome.summary}
              {outcome.verdict && (
                <Badge tone={outcome.success ? 'success' : 'danger'} className="verdict-badge">
                  判定: {outcome.verdict.verdict} | 匹配: {outcome.verdict.matched_cases.join(',')}
                </Badge>
              )}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
