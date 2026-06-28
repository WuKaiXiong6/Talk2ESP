// 文件路径：src/views/SettingsView.tsx
// 文件作用：设置视图——LLM配置/连接测试/供应商预设/Key掩码/自动化/引脚黑名单可视化/工具链检查/重置
// 最后更新时间：2026-06-28-1300

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Settings, ToolchainStatus } from '../types';
import { Button, Badge, Card } from '../components/ui';
import { PinMap } from '../components/PinMap';
import { useNotifications } from '../components/notifications';
import './SettingsView.css';

interface SettingsViewProps {
  onSaved: () => void;
}

/// #64 供应商预设
const PROVIDER_PRESETS: { label: string; provider: string; base_url: string; model: string }[] = [
  { label: '火山方舟（豆包）', provider: 'openai_compat', base_url: 'https://ark.cn-beijing.volces.com/api/coding/v3', model: 'doubao-1-5-pro' },
  { label: '智谱 GLM', provider: 'openai_compat', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { label: 'DeepSeek', provider: 'openai_compat', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问', provider: 'openai_compat', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'OpenAI', provider: 'openai_compat', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
];

export function SettingsView({ onSaved }: SettingsViewProps) {
  const notify = useNotifications();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  // #63 LLM 连接测试
  const [testingLlm, setTestingLlm] = useState(false);
  // #70 工具链检查
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null);
  const [checkingToolchain, setCheckingToolchain] = useState(false);
  // #65 API Key 掩码
  const [showKey, setShowKey] = useState(false);
  // #67 引脚可视化选中的芯片
  const [pinChip, setPinChip] = useState('esp32s3');
  const [chips, setChips] = useState<string[]>([]);

  useEffect(() => {
    invoke<Settings>('load_settings').then(setSettings).catch(() => {});
    invoke<string[]>('list_chips').then(setChips).catch(() => {});
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

  // #63 LLM 连接测试
  const testLlm = async () => {
    // 先保存当前设置再测试
    if (settings) {
      try { await invoke('save_settings', { settings }); } catch { /* 忽略 */ }
    }
    setTestingLlm(true);
    try {
      const msg = await invoke<string>('test_llm_connection');
      notify.success('LLM 连接正常', msg);
    } catch (e) {
      notify.error('LLM 连接失败', String(e));
    }
    setTestingLlm(false);
  };

  // #70 工具链健康检查
  const checkToolchain = async () => {
    setCheckingToolchain(true);
    try {
      const r = await invoke<ToolchainStatus>('check_toolchain');
      setToolchain(r);
      if (r.cli_found && r.esptool_available) notify.success('工具链就绪', `arduino-cli ${r.version ?? ''} + esptool`);
      else notify.warning('工具链不完整', r.error ?? '部分组件缺失');
    } catch (e) {
      notify.error('检查失败', String(e));
    }
    setCheckingToolchain(false);
  };

  // #72 重置设置
  const reset = async () => {
    if (!confirm('确认重置所有设置为默认值？此操作不可恢复。')) return;
    try {
      const defaults = await invoke<Settings>('load_settings'); // 重新加载（若无持久化则默认）
      setSettings(defaults);
      notify.info('已重置为当前加载的设置', '请按需修改后保存');
    } catch (e) { notify.error('重置失败', String(e)); }
  };

  if (!settings) return <div>加载设置中…</div>;

  return (
    <div className="settings-view">
      <h3>设置</h3>
      <p className="settings-hint">配置保存在 <code>%USERPROFILE%\.talk2esp\settings.json</code>，重启不丢失。</p>

      {/* LLM 配置 */}
      <Card className="settings-section">
        <h4>LLM 配置</h4>
        {/* #64 供应商预设 */}
        <div className="settings-row">
          <label>快捷预设</label>
          <select onChange={(e) => {
            const preset = PROVIDER_PRESETS[+e.target.value];
            if (preset) {
              update('llm.provider', preset.provider);
              update('llm.base_url', preset.base_url);
              update('llm.model', preset.model);
            }
          }} value="">
            <option value="" disabled>选择供应商预设…</option>
            {PROVIDER_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <label>供应商</label>
          <select value={settings.llm.provider} onChange={(e) => update('llm.provider', e.target.value)}>
            <option value="openai_compat">OpenAI 兼容（火山/智谱/DeepSeek/通义等）</option>
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
          {/* #65 API Key 掩码 */}
          <input
            type={showKey ? 'text' : 'password'}
            value={settings.llm.api_key}
            onChange={(e) => update('llm.api_key', e.target.value)}
            placeholder="your-api-key"
          />
          <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>{showKey ? '🙈 隐藏' : '👁 显示'}</Button>
        </div>
        <div className="settings-row">
          <label>模型名</label>
          <input value={settings.llm.model} onChange={(e) => update('llm.model', e.target.value)} placeholder="glm-4-plus" />
        </div>
        <div className="settings-row">
          <label>max_tokens</label>
          <input type="number" value={settings.llm.max_tokens} onChange={(e) => update('llm.max_tokens', +e.target.value)} />
          <span className="hint">推理模型建议 ≥ 8192</span>
        </div>
        {/* #63 LLM 连接测试 */}
        <div className="settings-row">
          <label></label>
          <Button variant="secondary" size="sm" onClick={testLlm} loading={testingLlm}>🔗 测试连接</Button>
        </div>
      </Card>

      {/* 自动化模式 */}
      <Card className="settings-section">
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
      </Card>

      {/* #67 引脚黑名单可视化 */}
      <Card className="settings-section">
        <h4>引脚黑名单可视化</h4>
        <div className="settings-row">
          <label>选择芯片</label>
          <select value={pinChip} onChange={(e) => setPinChip(e.target.value)}>
            {chips.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
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
        <div className="pinmap-wrapper">
          <PinMap chip={pinChip} extraError={settings.pin_blacklist.extra_error} extraWarn={settings.pin_blacklist.extra_warn} />
        </div>
      </Card>

      {/* 工具链 / 高级 */}
      <Card className="settings-section">
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
        {/* #70 工具链健康检查 */}
        <div className="settings-row">
          <label></label>
          <Button variant="secondary" size="sm" onClick={checkToolchain} loading={checkingToolchain}>🩺 工具链检查</Button>
        </div>
        {toolchain && (
          <div className="toolchain-status">
            <div className="toolchain-item">
              <span>arduino-cli</span>
              {toolchain.cli_found
                ? <Badge tone="success">✓ {toolchain.version ?? '已安装'}</Badge>
                : <Badge tone="danger" title={toolchain.error ?? ''}>✗ 未找到</Badge>}
            </div>
            <div className="toolchain-item">
              <span>路径</span>
              <code>{toolchain.cli_path ?? '-'}</code>
            </div>
            <div className="toolchain-item">
              <span>ESP32 核心</span>
              {toolchain.esp32_cores.length > 0
                ? toolchain.esp32_cores.map((c) => <Badge key={c} tone="info">{c}</Badge>)
                : <Badge tone="warning">未安装</Badge>}
            </div>
            <div className="toolchain-item">
              <span>esptool</span>
              {toolchain.esptool_available
                ? <Badge tone="success">✓ 可用</Badge>
                : <Badge tone="danger">✗ 不可用（py -m esptool）</Badge>}
            </div>
          </div>
        )}
      </Card>

      <div className="settings-actions">
        <Button variant="primary" onClick={save} loading={saving}>{saving ? '保存中…' : '💾 保存设置'}</Button>
        {/* #72 重置 */}
        <Button variant="ghost" onClick={reset}>↺ 重置</Button>
      </div>
    </div>
  );
}
