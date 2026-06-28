// 文件路径：src/components/ui/index.tsx
// 文件作用：统一设计系统基础组件——按钮/卡片/徽章/标签等，替代各处手写样式，保证视觉一致
// 最后更新时间：2026-06-28-1230

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

// ===== 按钮 =====
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载中状态（显示 spinner 并禁用）*/
  loading?: boolean;
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'ui-btn-sm',
  md: 'ui-btn-md',
  lg: 'ui-btn-lg',
};

/**
 * 统一按钮：primary 主操作、secondary 次操作、danger 危险操作、ghost 透明。
 * loading 时显示旋转图标并禁用点击。
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classes = ['ui-btn', `ui-btn-${variant}`, SIZE_CLASS[size]];
  if (loading) classes.push('ui-btn-loading');
  if (className) classes.push(className);
  return (
    <button
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden />}
      {children}
    </button>
  );
}

// ===== 卡片 =====
interface CardProps {
  children: ReactNode;
  className?: string;
  /** 是否可点击（如列表项卡片）*/
  interactive?: boolean;
  onClick?: () => void;
}

/** 统一卡片容器：圆角 + 阴影 + 表面背景 */
export function Card({ children, className, interactive, onClick }: CardProps) {
  const classes = ['ui-card'];
  if (interactive) classes.push('ui-card-interactive');
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')} onClick={onClick} role={interactive ? 'button' : undefined}>
      {children}
    </div>
  );
}

// ===== 徽章 / 标签 =====
type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** 状态徽章：用于项目状态、设备在线、重试次数等标识 */
export function Badge({ tone = 'default', children, className, title }: BadgeProps) {
  const classes = ['ui-badge', `ui-badge-${tone}`];
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} title={title}>
      {children}
    </span>
  );
}

// ===== 状态指示灯 =====
type StatusDotState = 'idle' | 'running' | 'success' | 'error' | 'warning';

interface StatusDotProps {
  state: StatusDotState;
  label?: string;
}

const DOT_LABEL: Record<StatusDotState, string> = {
  idle: '空闲',
  running: '运行中',
  success: '成功',
  error: '异常',
  warning: '警告',
};

/** 状态指示灯：用于全局/设备/项目状态，随状态变色 */
export function StatusDot({ state, label }: StatusDotProps) {
  const text = label ?? DOT_LABEL[state];
  return (
    <span className={`ui-status ui-status-${state}`} title={text}>
      <span className="ui-status-dot" aria-hidden />
      <span className="ui-status-label">{text}</span>
    </span>
  );
}

// ===== 图标按钮（纯文字图标，替代散乱 emoji，统一尺寸）=====
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className, ...rest }: IconButtonProps) {
  const classes = ['ui-icon-btn'];
  if (className) classes.push(className);
  return (
    <button className={classes.join(' ')} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
