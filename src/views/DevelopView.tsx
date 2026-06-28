// 文件路径：src/views/DevelopView.tsx
// 文件作用：开发视图——设备选择/需求输入/流水线时间线/代码展示/对话与日志分离/失败指引/思考可视化/历史快照
// 最后更新时间：2026-06-28-1240

import { useState, type RefObject } from 'react';
import type {
  DeviceInfo, PipelineOutcome, ConversationMessage,
} from '../types';
import { Button, Badge } from '../components/ui';
import { CodeBlock } from '../components/CodeBlock';
import { CodeEditor } from '../components/CodeEditor';
import { CodeDiff } from '../components/CodeDiff';
import {
  PipelineTimeline, deriveStageStatuses,
} from '../components/PipelineTimeline';
import { RequirementExamples } from '../components/RequirementExamples';
import { ChatMessage } from '../components/ChatMessage';

/// 开发视图属性
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
  // 阶段跟踪
  retryMap: Record<string, { attempt: number; max: number; reason: string }>;
  stageDurations: Record<string, number>;
  failReasonMap: Record<string, string>;
  llmStats: { durationMs: number; tokens?: number } | null;
  thinking: string;
  runHistory: {
    id: string; requirement: string; chip: string; port: string;
    success: boolean; summary: string; timestamp: string;
  }[];
  onRefreshDevices: () => void;
  onPort: (p: string) => void;
  onChip: (c: string) => void;
  onRequirement: (r: string) => void;
  onChat: () => void;
  onRun: () => void;
  onStop: () => void;
  onGoSettings: () => void;
  // #17 用编辑后的代码重跑
  onRerunEdited: (code: string) => void;
  // #86 代码导出
  onExportCode: (code: string) => void;
  // #77 重新生成
  onRegenerate?: () => void;
}

/// 日志/对话 子标签页
type MessageTab = 'chat' | 'logs';

export function DevelopView(props: DevelopViewProps) {
  const {
    devices, selectedPort, selectedChip, chips, requirement, running, currentState,
    progress, generatedCode, llmConfigured, chatHistory, logs, outcome, logEndRef,
    retryMap, stageDurations, failReasonMap, llmStats, thinking, runHistory,
    onRefreshDevices, onPort, onChip, onRequirement, onChat, onRun, onStop, onGoSettings,
    onRerunEdited, onExportCode, onRegenerate,
  } = props;

  // #22 对话区/日志区分离
  const [msgTab, setMsgTab] = useState<MessageTab>('chat');
  // #17 代码编辑模式
  const [editing, setEditing] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  // #83 diff 显示
  const [showDiff, setShowDiff] = useState(false);
  // 最近一次 AI 修复前的代码（用于 diff）；首版生成时为空
  const lastFixedCode = '';

  // #13/#14 计算时间线阶段状态
  const stages = deriveStageStatuses(
    currentState,
    outcome,
    Object.fromEntries(Object.entries(retryMap).map(([k, v]) => [k, { attempt: v.attempt, max: v.max }])),
    stageDurations,
    failReasonMap,
  );

  // #23 失败后下一步指引
  const failureGuidance = outcome && !outcome.success ? deriveFailureGuidance(outcome, failReasonMap) : null;

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
          {/* #18 需求快捷示例 */}
          {!running && <RequirementExamples onSelect={onRequirement} />}
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
              {/* #27 AI 思考子步骤可视化 */}
              {thinking && (
                <div className="thinking-indicator" role="status">
                  <span className="thinking-dots" aria-hidden>
                    <span /> <span /> <span />
                  </span>
                  <span className="thinking-text">{thinking}</span>
                </div>
              )}
              <span className="progress-percent">{progress.percent}%</span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill progress-${currentState || (outcome?.success ? 'archived' : outcome ? 'failed' : 'idle')}`}
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="progress-message">{progress.message}</div>

            {/* #13/#14 流水线时间线 + 重试徽章 */}
            {(running || outcome) && (
              <div className="timeline-wrapper">
                <PipelineTimeline stages={stages} />
              </div>
            )}

            {/* #28 LLM 耗时统计 */}
            {llmStats && (
              <div className="llm-stats">
                <Badge tone="info">AI 生成耗时 {(llmStats.durationMs / 1000).toFixed(1)}s</Badge>
                {llmStats.tokens && <Badge tone="default">tokens {llmStats.tokens}</Badge>}
              </div>
            )}
          </div>
        )}

        {/* #23 失败后下一步指引 */}
        {failureGuidance && (
          <div className="failure-guidance" role="alert">
            <div className="failure-guidance-title">💡 下一步建议</div>
            <ul>
              {failureGuidance.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          </div>
        )}

        {generatedCode && (
          <div className="code-section">
            <h4>
              AI 生成的代码
              {generatedCode.explanation && <span className="code-explain">— {generatedCode.explanation}</span>}
            </h4>
            {/* #16 代码语法高亮 + #17 可编辑重跑 + #81 编辑器 */}
            {editing ? (
              <div className="code-edit-area">
                <CodeEditor
                  value={editedCode}
                  onChange={setEditedCode}
                  language="arduino"
                  minHeight="320px"
                  placeholder="可在此编辑代码后重跑（跳过 AI 生成）"
                />
                <div className="code-edit-actions">
                  <Button variant="primary" size="sm" onClick={() => onRerunEdited(editedCode)} disabled={running}>
                    🔄 用编辑后的代码重跑
                  </Button>
                  {/* #83 diff 对比 */}
                  {lastFixedCode && (
                    <Button variant="secondary" size="sm" onClick={() => setShowDiff((v) => !v)}>
                      {showDiff ? '隐藏' : '查看'} diff
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setEditedCode(generatedCode.main_ino); }}>
                    取消编辑
                  </Button>
                </div>
                {/* #83 AI 修复前后 diff */}
                {showDiff && lastFixedCode && (
                  <CodeDiff oldCode={lastFixedCode} newCode={editedCode} title="AI 修复前 → 编辑后" />
                )}
              </div>
            ) : (
              <>
                <CodeBlock code={generatedCode.main_ino} language="arduino" maxHeight="320px" title="main.ino" />
                <div className="code-edit-actions">
                  {/* #17 进入编辑模式 */}
                  <Button variant="secondary" size="sm" onClick={() => { setEditing(true); setEditedCode(generatedCode.main_ino); }} disabled={running}>
                    ✏ 编辑代码
                  </Button>
                  {/* #86 代码导出 */}
                  <Button variant="ghost" size="sm" onClick={() => onExportCode(generatedCode.main_ino)}>📥 导出 .ino</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="chat-log ui-card">
        {/* #22 对话区/日志区分离 */}
        <div className="msg-tabs">
          <button
            className={`msg-tab ${msgTab === 'chat' ? 'active' : ''}`}
            onClick={() => setMsgTab('chat')}
          >
            对话 ({chatHistory.length})
          </button>
          <button
            className={`msg-tab ${msgTab === 'logs' ? 'active' : ''}`}
            onClick={() => setMsgTab('logs')}
          >
            过程日志 ({logs.length})
          </button>
        </div>
        <div className="messages">
          {msgTab === 'chat' ? (
            chatHistory.length === 0 ? (
              <div className="empty-inline">暂无对话，点击「与 AI 对话澄清」开始</div>
            ) : (
              // #76 Markdown 渲染 + #77 复制/重新生成
              chatHistory.map((m, i) => (
                <ChatMessage key={`msg-${i}`} message={m} onRegenerate={m.role === 'assistant' && i === chatHistory.length - 1 ? onRegenerate : undefined} />
              ))
            )
          ) : (
            <>
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
            </>
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* #30 运行历史快照（会话内） */}
      {runHistory.length > 0 && (
        <div className="run-history ui-card">
          <h4>本次会话运行历史（{runHistory.length}）</h4>
          <div className="run-history-list">
            {runHistory.map((h) => (
              <div key={h.id} className={`run-history-item ${h.success ? 'success' : 'fail'}`}>
                <span className="run-history-icon">{h.success ? '✅' : '❌'}</span>
                <span className="run-history-req" title={h.requirement}>{h.requirement.slice(0, 40)}</span>
                <span className="run-history-meta">{h.chip} · {h.port}</span>
                <span className="run-history-time">{new Date(h.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/// #23 根据失败结果与失败阶段给出下一步指引
function deriveFailureGuidance(
  outcome: PipelineOutcome,
  failReasonMap: Record<string, string>,
): string[] {
  const guidance: string[] = [];
  if (failReasonMap.coding) {
    guidance.push('AI 代码生成失败：可尝试更精确地描述需求，或检查 LLM 配置（模型/max_tokens）。');
  }
  if (failReasonMap.compiling) {
    guidance.push('编译失败：检查芯片选择是否正确；查看日志中的编译错误，可能需要调整引脚或库依赖。');
  }
  if (failReasonMap.flashing) {
    guidance.push('烧录失败：确认设备已连接且端口未被其他程序占用；尝试重新插拔 USB；检查是否需要按 BOOT 键。');
  }
  if (failReasonMap.verifying) {
    guidance.push('验证失败：设备未输出预期的 TEST:PASS 标记。检查串口监视器是否有输出；可能是代码逻辑或硬件接线问题。');
  }
  if (guidance.length === 0) {
    guidance.push(outcome.summary || '请查看过程日志定位失败原因。');
  }
  return guidance;
}
