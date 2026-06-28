// 文件路径：src/components/EmptyState.tsx
// 文件作用：空状态组件——无数据时配插画占位 + 明确下一步引导按钮，把"无内容"转化为"可行动"
// 最后更新时间：2026-06-28-1230

import type { ReactNode } from 'react';
import './EmptyState.css';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  /** 插画/图标（emoji 或文本）*/
  icon?: string;
  /** 主标题 */
  title: string;
  /** 说明文字 */
  description?: string;
  /** 引导操作按钮 */
  actions?: EmptyStateAction[];
  /** 自定义额外内容 */
  children?: ReactNode;
}

/**
 * 统一空状态：用插画 + 引导按钮替代单调的"暂无…"文字。
 */
export function EmptyState({ icon = '📭', title, description, actions, children }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {actions && actions.length > 0 && (
        <div className="empty-state-actions">
          {actions.map((a) => (
            <button key={a.label} className="empty-state-btn" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
