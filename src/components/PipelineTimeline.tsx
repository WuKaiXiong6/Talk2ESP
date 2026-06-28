// 文件路径：src/components/PipelineTimeline.tsx
// 文件作用：流水线时间线——分步展示 coding/compiling/flashing/verifying 各阶段状态与重试徽章
// 最后更新时间：2026-06-28-1240

import { Badge } from './ui';
import './PipelineTimeline.css';

/// 单个阶段状态
export type StageStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/// 时间线阶段定义
export interface TimelineStage {
  key: string;
  label: string;
  icon: string;
  status: StageStatus;
  /** 重试次数（用于重试徽章）*/
  retryAttempt?: number;
  retryMax?: number;
  /** 阶段耗时（毫秒）*/
  durationMs?: number;
  /** 失败原因 */
  failReason?: string;
}

interface PipelineTimelineProps {
  stages: TimelineStage[];
}

const STATUS_LABEL: Record<StageStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  skipped: '跳过',
};

/// 毫秒转可读时长
function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 流水线时间线：垂直排列各阶段，连线显示进度，每阶段含状态图标/重试徽章/耗时/失败原因。
 * 复用现有 PipelineEvent（StateChanged/Retry）数据，由父组件维护 stages 状态。
 */
export function PipelineTimeline({ stages }: PipelineTimelineProps) {
  return (
    <div className="pipeline-timeline" role="list" aria-label="流水线阶段">
      {stages.map((stage, idx) => (
        <div key={stage.key} className="timeline-stage" role="listitem">
          {/* 连线（除最后一个）*/}
          {idx < stages.length - 1 && (
            <div className={`timeline-line timeline-line-${stage.status}`} aria-hidden />
          )}
          {/* 节点 */}
          <div className={`timeline-node timeline-node-${stage.status}`}>
            <span aria-hidden>{stage.icon}</span>
            {stage.status === 'running' && <span className="timeline-spinner" aria-hidden />}
          </div>
          {/* 内容 */}
          <div className="timeline-content">
            <div className="timeline-header">
              <span className="timeline-label">{stage.label}</span>
              <span className="timeline-badges">
                {stage.retryAttempt && stage.retryAttempt > 0 && (
                  <Badge tone="warning" title={`重试 ${stage.retryAttempt}/${stage.retryMax}`}>
                    ↻ {stage.retryAttempt}/{stage.retryMax}
                  </Badge>
                )}
                {stage.durationMs ? (
                  <Badge tone="info">{formatDuration(stage.durationMs)}</Badge>
                ) : null}
                <Badge
                  tone={
                    stage.status === 'success' ? 'success'
                      : stage.status === 'failed' ? 'danger'
                      : stage.status === 'running' ? 'info'
                      : 'default'
                  }
                >
                  {STATUS_LABEL[stage.status]}
                </Badge>
              </span>
            </div>
            {stage.failReason && (
              <div className="timeline-fail-reason" title={stage.failReason}>
                ⚠ {stage.failReason}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/// 默认四阶段定义（coding/compiling/flashing/verifying）
export const DEFAULT_PIPELINE_STAGES: Omit<TimelineStage, 'status'>[] = [
  { key: 'coding', label: 'AI 生成代码', icon: '🧠' },
  { key: 'compiling', label: '编译', icon: '⚙️' },
  { key: 'flashing', label: '烧录', icon: '📡' },
  { key: 'verifying', label: '验证', icon: '🔍' },
];

/// 根据 currentState 与 outcome 计算各阶段状态
export function deriveStageStatuses(
  currentState: string,
  outcome: { success: boolean } | null,
  retryMap: Record<string, { attempt: number; max: number }>,
  durationMap: Record<string, number>,
  failReasonMap: Record<string, string>,
): TimelineStage[] {
  const order = ['coding', 'compiling', 'flashing', 'verifying'];
  const currentIdx = order.indexOf(currentState);
  return DEFAULT_PIPELINE_STAGES.map((s, idx) => {
    let status: StageStatus = 'pending';
    if (outcome) {
      // 已结束
      if (outcome.success) {
        status = 'success';
      } else if (idx === (currentIdx >= 0 ? currentIdx : order.length - 1)) {
        status = 'failed';
      } else if (currentIdx >= 0 && idx < currentIdx) {
        status = 'success';
      }
    } else if (currentIdx >= 0) {
      if (idx < currentIdx) status = 'success';
      else if (idx === currentIdx) status = 'running';
    }
    const retry = retryMap[s.key];
    return {
      ...s,
      status,
      retryAttempt: retry?.attempt,
      retryMax: retry?.max,
      durationMs: durationMap[s.key],
      failReason: status === 'failed' ? failReasonMap[s.key] : undefined,
    };
  });
}
