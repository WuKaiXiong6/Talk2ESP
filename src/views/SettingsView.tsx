// 文件路径：src/views/SettingsView.tsx
// 文件作用：设置视图——LLM配置/自动化模式/引脚黑名单/工具链高级
// 最后更新时间：2026-06-28-1230

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Settings } from '../types';
import { Button } from '../components/ui';
import { useNotifications } from '../components/notifications/NotificationContext';

interface SettingsViewProps {
  onSaved: () => void;
}

export function SettingsView({ onSaved }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const notify = useNotifications();

  useEffect(() => {
    invoke<Settings>('load_settings').then(setSettings).catch(() => {});
  }, []);

  const update = (path: string, value: unknown) => {
    if (!settings) return;
    const next = JSON.parse(JSON.stringify(settings)) as Settings;
    const keys = path.split('.');
    let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    obj[keys[keys.length - 1]] = value;
    setSettings(next);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await invoke('save_settings', { settings });
      onSaved();
      notify.success('设置已保存', '配置已写入 settings.json，重启不丢失');
    } catch (e) {
      notify.error('保存设置失败', String(e));
    }
    setSaving(false);
  };

  if (!settings) return <div>加载设置中…</div>;

  return (
    <div className="settings-view ui-card">
      <h3>设置</h3>
      <p className="settings-hint">配置保存在 <code>%USERPROFILE%\.talk2esp\settings.json</code>，重启不丢失。</p>

      <div className="settings-section">
        <h4>LLM 配置</h4>
        <div className="settings-row">
          <label>供应商</label>
          <select value={settings.llm.provider} onChange={(e) => update('llm.provider', e.target.value)}>
            <option value="openai_compat">OpenAI 兼容（火山方舟/智谱/DeepSeek/通义等）</option>
            <option value="claude">Claude（暂未实现）</option>
          </select>
        </div>
        <div className="settings-row">
          <label>Base URL</label>
          <input value={settings.llm.base_url} onChange={(e) => update('llm.base_url', e.target.value)}
            placeholder="https://ark.cn-beijing.volces.com/api/coding/v3" />
        </div>
        <div className="settings-row">
          <label>API Key</label>
          <input type="password" value={settings.llm.api_key} onChange={(e) => update('llm.api_key', e.target.value)}
            placeholder="your-api-key" />
        </div>
        <div className="settings-row">
          <label>模型名</label>
          <input value={settings.llm.model} onChange={(e) => update('llm.model', e.target.value)}
            placeholder="glm-5.2" />
        </div>
        <div className="settings-row">
          <label>max_tokens</label>
          <input type="number" value={settings.llm.max_tokens} onChange={(e) => update('llm.max_tokens', +e.target.value)} />
          <span className="hint">推理模型建议 ≥ 8192</span>
        </div>
      </div>

      <div className="settings-section">
        <h4>自动化模式</h4>
        <div className="settings-row">
          <label>模式</label>
          <select value={settings.automation.mode} onChange={(e) => update('automation.mode', e.target.value)}>
            <option value="full">全自动（连续执行）</option>
            <option value="step">分步确认（每步需确认）</option>
          </select>
        </div>
        <div className="settings-row">
          <label>烧录前确认</label>
          <input type="checkbox" checked={settings.automation.confirm_before_flash}
            onChange={(e) => update('automation.confirm_before_flash', e.target.checked)} />
          <span className="hint">开启后烧录前需手动确认</span>
        </div>
      </div>

      <div className="settings-section">
        <h4>引脚黑名单自定义</h4>
        <div className="settings-row">
          <label>额外禁止引脚(逗号分隔)</label>
          <input value={settings.pin_blacklist.extra_error.join(',')}
            onChange={(e) => update('pin_blacklist.extra_error', e.target.value.split(',').map((s) => +s.trim()).filter((n) => !isNaN(n)))}
            placeholder="如 9,10" />
        </div>
        <div className="settings-row">
          <label>额外提示引脚(逗号分隔)</label>
          <input value={settings.pin_blacklist.extra_warn.join(',')}
            onChange={(e) => update('pin_blacklist.extra_warn', e.target.value.split(',').map((s) => +s.trim()).filter((n) => !isNaN(n)))}
            placeholder="如 11,12" />
        </div>
      </div>

      <div className="settings-section">
        <h4>工具链 / 高级</h4>
        <div className="settings-row">
          <label>arduino-cli 路径</label>
          <input value={settings.toolchain.arduino_cli_path} onChange={(e) => update('toolchain.arduino_cli_path', e.target.value)}
            placeholder="留空则用内置或系统 PATH" />
        </div>
        <div className="settings-row">
          <label>默认波特率</label>
          <input type="number" value={settings.toolchain.default_baud} onChange={(e) => update('toolchain.default_baud', +e.target.value)} />
        </div>
        <div className="settings-row">
          <label>详细日志</label>
          <input type="checkbox" checked={settings.toolchain.verbose_log}
            onChange={(e) => update('toolchain.verbose_log', e.target.checked)} />
        </div>
      </div>

      <div className="settings-actions">
        <Button variant="primary" onClick={save} loading={saving}>{saving ? '保存中…' : '💾 保存设置'}</Button>
      </div>
    </div>
  );
}
