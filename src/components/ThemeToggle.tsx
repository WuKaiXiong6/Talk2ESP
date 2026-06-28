// 文件路径：src/components/ThemeToggle.tsx
// 文件作用：主题切换控件——深色/浅色/跟随系统三态切换 + 字号调节入口
// 最后更新时间：2026-06-28-1235

import { useState } from 'react';
import type { ThemeMode, FontScale } from '../theme/useTheme';
import './ThemeToggle.css';

interface ThemeToggleProps {
  mode: ThemeMode;
  fontScale: FontScale;
  onMode: (m: ThemeMode) => void;
  onFontScale: (s: FontScale) => void;
  fontScaleLabel: (s: FontScale) => string;
}

const MODE_OPTIONS: { value: ThemeMode; icon: string; label: string }[] = [
  { value: 'light', icon: '☀️', label: '浅色' },
  { value: 'dark', icon: '🌙', label: '深色' },
  { value: 'auto', icon: '🖥️', label: '跟随系统' },
];

const FONT_OPTIONS: FontScale[] = ['sm', 'base', 'lg', 'xl'];

/**
 * 主题切换控件：图标按钮 + 下拉面板（主题三态 + 字号四档）。
 * 点击外部收起面板。
 */
export function ThemeToggle({ mode, fontScale, onMode, onFontScale, fontScaleLabel }: ThemeToggleProps) {
  const [open, setOpen] = useState(false);

  const currentIcon = MODE_OPTIONS.find((o) => o.value === mode)?.icon ?? '🖥️';

  return (
    <div className="theme-toggle">
      <button
        className="theme-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        title="主题与显示设置"
        aria-label="主题与显示设置"
        aria-expanded={open}
      >
        {currentIcon}
      </button>
      {open && (
        <>
          {/* 点击遮罩收起 */}
          <div className="theme-toggle-mask" onClick={() => setOpen(false)} aria-hidden />
          <div className="theme-toggle-panel" role="dialog" aria-label="主题设置">
            <div className="theme-toggle-group">
              <div className="theme-toggle-label">主题</div>
              <div className="theme-toggle-row">
                {MODE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={`theme-toggle-option ${mode === o.value ? 'active' : ''}`}
                    onClick={() => onMode(o.value)}
                    title={o.label}
                  >
                    <span aria-hidden>{o.icon}</span>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="theme-toggle-group">
              <div className="theme-toggle-label">字号</div>
              <div className="theme-toggle-row">
                {FONT_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`theme-toggle-option ${fontScale === s ? 'active' : ''}`}
                    onClick={() => onFontScale(s)}
                  >
                    {fontScaleLabel(s)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
