// 文件路径：src/components/notifications/NotificationContext.tsx
// 文件作用：全局通知系统——统一呈现成功/警告/错误/信息提示，可堆叠、可手动关闭、可回看历史，
//           替代 alert() 阻塞弹窗与塞入日志流的做法
// 最后更新时间：2026-06-28-1230

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/// 通知级别
export type NotificationLevel = 'success' | 'warning' | 'error' | 'info';

/// 单条通知结构
export interface NotificationItem {
  id: string;
  level: NotificationLevel;
  title: string;
  message?: string;
  /** 创建时间戳（ISO，用于历史回看）*/
  timestamp: string;
  /** 自动关闭时长（毫秒），0 表示不自动关闭 */
  duration: number;
}

/// 通知系统对外接口
interface NotificationContextValue {
  /** 当前堆叠显示中的通知（未关闭）*/
  notifications: NotificationItem[];
  /** 历史通知（含已关闭，最近 100 条）*/
  history: NotificationItem[];
  /** 是否展开历史面板 */
  historyOpen: boolean;
  /** 发送一条通知 */
  notify: (level: NotificationLevel, title: string, message?: string, duration?: number) => void;
  /** 快捷方法 */
  success: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  /** 关闭单条通知 */
  dismiss: (id: string) => void;
  /** 切换历史面板 */
  toggleHistory: () => void;
  /** 清空全部当前通知 */
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

/// 默认自动关闭时长（毫秒）
const DEFAULT_DURATION: Record<NotificationLevel, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  // 错误通知不自动关闭，需用户手动处理
  error: 0,
};

/// 历史记录上限
const HISTORY_LIMIT = 100;

let idCounter = 0;
const nextId = () => `n-${Date.now()}-${idCounter++}`;

interface NotificationProviderProps {
  children: ReactNode;
}

/**
 * 通知系统 Provider：在应用根部包裹，提供全局通知能力。
 * 右上角堆叠显示当前通知，并提供历史回看面板。
 */
export function NotificationProvider({ children }: NotificationProviderProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [history, setHistory] = useState<NotificationItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 定时器引用表，避免组件卸载时泄漏
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setNotifications((list) => list.filter((n) => n.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (level: NotificationLevel, title: string, message?: string, duration?: number) => {
      const item: NotificationItem = {
        id: nextId(),
        level,
        title,
        message,
        timestamp: new Date().toISOString(),
        duration: duration ?? DEFAULT_DURATION[level],
      };
      setNotifications((list) => [...list, item]);
      setHistory((h) => [item, ...h].slice(0, HISTORY_LIMIT));

      if (item.duration > 0) {
        const timer = setTimeout(() => dismiss(item.id), item.duration);
        timersRef.current.set(item.id, timer);
      }
    },
    [dismiss],
  );

  const success = useCallback((t: string, m?: string) => notify('success', t, m), [notify]);
  const warning = useCallback((t: string, m?: string) => notify('warning', t, m), [notify]);
  const error = useCallback((t: string, m?: string) => notify('error', t, m), [notify]);
  const info = useCallback((t: string, m?: string) => notify('info', t, m), [notify]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach((t) => clearTimeout(t));
    timersRef.current.clear();
    setNotifications([]);
  }, []);

  const toggleHistory = useCallback(() => setHistoryOpen((v) => !v), []);

  // 组件卸载时清理所有定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      history,
      historyOpen,
      notify,
      success,
      warning,
      error,
      info,
      dismiss,
      toggleHistory,
      clearAll,
    }),
    [notifications, history, historyOpen, notify, success, warning, error, info, dismiss, toggleHistory, clearAll],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

/// 获取通知系统接口的 Hook
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications 必须在 NotificationProvider 内使用');
  }
  return ctx;
}
