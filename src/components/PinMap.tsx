// 文件路径：src/components/PinMap.tsx
// 文件作用：引脚黑名单可视化——以网格展示芯片全部引脚，按 error/warn/safe 着色，悬浮显示备注
// 最后更新时间：2026-06-28-1300

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChipDescriptor } from '../types';
import { Badge } from './ui';
import './PinMap.css';

interface PinMapProps {
  chip: string;
  /// 额外禁止/提示引脚（来自用户设置）
  extraError?: number[];
  extraWarn?: number[];
}

/// 引脚分类
type PinClass = 'error' | 'error-octal' | 'warn' | 'extra-error' | 'extra-warn' | 'safe' | 'safe-default';

const CLASS_LABEL: Record<PinClass, string> = {
  error: '禁止（Flash/PSRAM）',
  'error-octal': '禁止（Octal 变体）',
  warn: '警告（Strapping/USB等）',
  'extra-error': '用户禁止',
  'extra-warn': '用户警告',
  safe: '可用',
  'safe-default': '推荐默认',
};

/**
 * 引脚黑名单可视化：加载芯片描述符，以网格展示所有引脚并着色。
 * 悬浮显示引脚备注与分类说明。
 */
export function PinMap({ chip, extraError = [], extraWarn = [] }: PinMapProps) {
  const [descriptor, setDescriptor] = useState<ChipDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    setError(null);
    invoke<ChipDescriptor>('get_chip_descriptor', { chip })
      .then(setDescriptor)
      .catch((e) => setError(String(e)));
  }, [chip]);

  if (error) return <div className="pinmap-error">加载引脚描述失败：{error}</div>;
  if (!descriptor) return <div className="pinmap-loading">加载引脚信息中…</div>;

  const octal = descriptor.pin_blacklist_error_octal ?? [];
  const notes = descriptor.pin_notes ?? {};
  const pins = Array.from({ length: descriptor.pin_count }, (_, i) => i);

  /// 判定单个引脚分类
  const classify = (pin: number): PinClass => {
    if (descriptor.pin_blacklist_error.includes(pin)) return 'error';
    if (octal.includes(pin)) return 'error-octal';
    if (extraError.includes(pin)) return 'extra-error';
    if (descriptor.pin_blacklist_warn.includes(pin)) return 'warn';
    if (extraWarn.includes(pin)) return 'extra-warn';
    if (descriptor.pin_safe_default.includes(pin)) return 'safe-default';
    return 'safe';
  };

  return (
    <div className="pinmap">
      <div className="pinmap-header">
        <span className="pinmap-chip">{descriptor.chip}</span>
        <span className="pinmap-fqbn">{descriptor.fqbn}</span>
        <span className="pinmap-count">{descriptor.pin_count} 引脚</span>
      </div>
      <div className="pinmap-legend">
        {(['error', 'error-octal', 'warn', 'extra-error', 'extra-warn', 'safe-default', 'safe'] as PinClass[]).map((c) => (
          <Badge key={c} tone={
            c === 'error' || c === 'error-octal' || c === 'extra-error' ? 'danger'
              : c === 'warn' || c === 'extra-warn' ? 'warning'
              : c === 'safe-default' ? 'success' : 'default'
          }>
            <span className={`pinmap-dot pinmap-${c}`} aria-hidden /> {CLASS_LABEL[c]}
          </Badge>
        ))}
      </div>
      <div className="pinmap-grid">
        {pins.map((pin) => {
          const cls = classify(pin);
          const note = notes[String(pin)];
          return (
            <div
              key={pin}
              className={`pinmap-cell pinmap-${cls}`}
              onMouseEnter={() => setHovered(pin)}
              onMouseLeave={() => setHovered(null)}
              title={note ? `GPIO${pin}: ${note}` : `GPIO${pin}: ${CLASS_LABEL[cls]}`}
            >
              <span className="pinmap-pin-num">{pin}</span>
            </div>
          );
        })}
      </div>
      {hovered !== null && notes[String(hovered)] && (
        <div className="pinmap-note">
          <strong>GPIO{hovered}</strong>: {notes[String(hovered)]}
        </div>
      )}
    </div>
  );
}
