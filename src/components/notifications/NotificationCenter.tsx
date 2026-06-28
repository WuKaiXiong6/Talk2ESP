// 文件路径：src/components/notifications/NotificationCenter.tsx
// 文件作用：通知中心 UI——右上角堆叠显示当前通知，含历史回看面板
// 最后更新时间：2026-06-28-1230

import { useNotifications } from './NotificationContext';
import type { NotificationLevel } from './NotificationContext';
import './NotificationCenter.css';

/// 各级别对应的图标与标签
const LEVEL_META: Record<NotificationLevel, { icon: string; label: string }> = {
  success: { icon: '✓', label: '成功' },
  warning: { icon: '⚠', label: '警告' },
  error: { icon: '✕', label: '错误' },
  info: { icon: 'ℹ', label: '提示' },
};

/**
 * 通知中心：渲染当前堆叠通知与历史面板。
 * 应挂载在应用根节点内，位置固定在右上角。
 */
export function NotificationCenter() {
  const { notifications, history, historyOpen, dismiss, toggleHistory, clearAll } = useNotifications();

  return (
    <div className="notification-root" role="region" aria-label="通知中心">
      {/* 当前通知堆叠区 */}
      <div className="notification-stack">
        {notifications.map((n) => {
          const meta = LEVEL_META[n.level];
          return (
            <div key={n.id} className={`notification-toast notification-${n.level}`} role="alert">
              <span className="notification-icon" aria-hidden>{meta.icon}</span>
              <div className="notification-body">
                <div className="notification-title">{n.title}</div>
                {n.message && <div className="notification-message">{n.message}</div>}
              </div>
              <button
                className="notification-close"
                onClick={() => dismiss(n.id)}
                aria-label="关闭通知"
                title="关闭"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* 历史回看面板 */}
      {historyOpen && (
        <div className="notification-history" role="dialog" aria-label="通知历史">
          <div className="notification-history-header">
            <span>通知历史（{history.length}）</span>
            <div className="notification-history-actions">
              {notifications.length > 0 && (
                <button className="notification-history-btn" onClick={clearAll}>清空当前</button>
              )}
              <button className="notification-history-btn" onClick={toggleHistory}>关闭</button>
            </div>
          </div>
          <div className="notification-history-list">
            {history.length === 0 ? (
              <div className="notification-history-empty">暂无历史通知</div>
            ) : (
              history.map((n) => {
                const meta = LEVEL_META[n.level];
                const time = new Date(n.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
                return (
                  <div key={n.id} className={`notification-history-item notification-${n.level}`}>
                    <span className="notification-history-time">{time}</span>
                    <span className="notification-history-icon" aria-hidden>{meta.icon}</span>
                    <span className="notification-history-title">{n.title}</span>
                    {n.message && <span className="notification-history-message">{n.message}</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 历史入口按钮（有历史时显示）*/}
      {history.length > 0 && !historyOpen && (
        <button
          className="notification-history-toggle"
          onClick={toggleHistory}
          title="查看通知历史"
          aria-label="查看通知历史"
        >
          🕐
        </button>
      )}
    </div>
  );
}
