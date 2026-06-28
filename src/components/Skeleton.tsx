// 文件路径：src/components/Skeleton.tsx
// 文件作用：加载骨架屏——数据加载期间展示与最终布局一致的灰块占位，避免内容跳动
// 最后更新时间：2026-06-28-1230

import './Skeleton.css';

interface SkeletonProps {
  /** 宽度，默认 100% */
  width?: string | number;
  /** 高度，默认 16px */
  height?: string | number;
  /** 圆角，默认 md */
  radius?: 'sm' | 'md' | 'lg' | 'full';
  /** 额外类名 */
  className?: string;
}

const RADIUS_MAP = {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  full: 'var(--radius-full)',
};

/** 单个骨架灰块 */
export function Skeleton({ width = '100%', height = 16, radius = 'md', className }: SkeletonProps) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: RADIUS_MAP[radius],
  };
  return <div className={`skeleton ${className ?? ''}`} style={style} aria-hidden />;
}

/** 表格行骨架（用于设备/项目列表加载）*/
export function SkeletonTable({ rows = 4, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" aria-label="加载中">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-table-row" key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 卡片骨架（用于设备/项目卡片加载）*/
export function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-label="加载中">
      <Skeleton width={120} height={20} />
      <Skeleton height={12} />
      <Skeleton height={12} width="70%" />
      <div className="skeleton-card-row">
        <Skeleton width={80} height={28} radius="full" />
        <Skeleton width={60} height={28} radius="full" />
      </div>
    </div>
  );
}
