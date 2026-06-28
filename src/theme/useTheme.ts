// 文件路径：src/theme/useTheme.ts
// 文件作用：主题管理——深色/浅色主题切换 + 字号调节 + localStorage 持久化 + 系统偏好跟随
// 最后更新时间：2026-06-28-1235

import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';

/// 字号档位（相对缩放系数，作用于 :root font-size）
export type FontScale = 'sm' | 'base' | 'lg' | 'xl';

const FONT_SCALE_VALUE: Record<FontScale, string> = {
  sm: '13px',
  base: '14px',
  lg: '16px',
  xl: '18px',
};

const FONT_SCALE_LABEL: Record<FontScale, string> = {
  sm: '小',
  base: '标准',
  lg: '大',
  xl: '超大',
};

const STORAGE_KEY = 'talk2esp-theme';
const FONT_KEY = 'talk2esp-font-scale';

interface ThemePersist {
  mode: ThemeMode;
}

interface FontPersist {
  scale: FontScale;
}

/// 判断系统当前是否深色模式
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/// 读取已持久化的主题模式，默认 auto
function loadMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as ThemePersist;
      if (v.mode === 'light' || v.mode === 'dark' || v.mode === 'auto') return v.mode;
    }
  } catch {
    /* 忽略损坏的存储，回退默认 */
  }
  return 'auto';
}

/// 读取已持久化的字号档位，默认 base
function loadScale(): FontScale {
  try {
    const raw = localStorage.getItem(FONT_KEY);
    if (raw) {
      const v = JSON.parse(raw) as FontPersist;
      if (v.scale === 'sm' || v.scale === 'base' || v.scale === 'lg' || v.scale === 'xl') return v.scale;
    }
  } catch {
    /* 忽略损坏的存储 */
  }
  return 'base';
}

export interface UseThemeResult {
  mode: ThemeMode;
  /** 实际生效的主题（auto 解析后）*/
  resolved: 'light' | 'dark';
  fontScale: FontScale;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  setFontScale: (s: FontScale) => void;
  fontScaleLabel: (s: FontScale) => string;
}

/**
 * 主题管理 Hook：将主题与字号写入 <html> 的 data-theme 属性与 font-size，
 * 并监听系统偏好变化，使 auto 模式实时跟随。
 */
export function useTheme(): UseThemeResult {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [fontScale, setFontScaleState] = useState<FontScale>(loadScale);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark());

  // 监听系统主题变化（仅 auto 模式下生效）
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;

  // 主题变化时写入 <html data-theme> 并持久化
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode } satisfies ThemePersist));
  }, [mode]);

  // 字号变化时写入 :root font-size 并持久化
  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SCALE_VALUE[fontScale];
  }, [fontScale]);

  useEffect(() => {
    localStorage.setItem(FONT_KEY, JSON.stringify({ scale: fontScale } satisfies FontPersist));
  }, [fontScale]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const toggle = useCallback(() => {
    setModeState((cur) => (cur === 'dark' ? 'light' : 'dark'));
  }, []);
  const setFontScale = useCallback((s: FontScale) => setFontScaleState(s), []);
  const fontScaleLabel = useCallback((s: FontScale) => FONT_SCALE_LABEL[s], []);

  return { mode, resolved, fontScale, setMode, toggle, setFontScale, fontScaleLabel };
}
