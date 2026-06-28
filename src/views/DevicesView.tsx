// 文件路径：src/views/DevicesView.tsx
// 文件作用：设备管理视图——设备卡片化 + 详情 + 热插拔感知 + 识别失败引导 + 占用冲突 + 连接测试 + 驱动检测
// 最后更新时间：2026-06-28-1250

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo, DriverInfo, ConnectionTestResult } from '../types';
import { Button, Badge, Card, IconButton } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { useNotifications } from '../components/notifications';
import './DevicesView.css';

interface DevicesViewProps {
  devices: DeviceInfo[];
  loading: boolean;
  selectedPort: string;
  onRefresh: () => void;
  onSelect: (port: string, chip: string | null) => void;
  onGoDevelop: () => void;
  onGoMonitor: () => void;
}

/// 热插拔事件类型
type PlugEvent = { type: 'connect' | 'disconnect'; port: string; ts: string };

export function DevicesView(props: DevicesViewProps) {
  const { devices, loading, selectedPort, onRefresh, onSelect, onGoDevelop, onGoMonitor } = props;
  const notify = useNotifications();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [driverMap, setDriverMap] = useState<Record<string, DriverInfo>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  // #43 热插拔感知：前端轮询比对
  const [plugEvents, setPlugEvents] = useState<PlugEvent[]>([]);
  const prevPortsRef = useRef<string[]>([]);
  // #51 设备别名与记忆：localStorage 持久化 port -> alias
  const [aliases, setAliases] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('talk2esp-device-aliases') ?? '{}'); } catch { return {}; }
  });
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState('');

  // #51 持久化别名
  const saveAlias = (port: string, alias: string) => {
    const next = { ...aliases };
    if (alias.trim()) next[port] = alias.trim();
    else delete next[port];
    setAliases(next);
    localStorage.setItem('talk2esp-device-aliases', JSON.stringify(next));
    setEditingAlias(null);
  };

  // #43 热插拔感知：每 3 秒轮询设备列表比对变化（不改后端扫描）
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const list = await invoke<DeviceInfo[]>('scan_ports').catch(() => []);
        if (!active) return;
        const currentPorts = list.map((d) => d.port).sort();
        const prev = prevPortsRef.current;
        if (prev.length > 0) {
          const connected = currentPorts.filter((p) => !prev.includes(p));
          const disconnected = prev.filter((p) => !currentPorts.includes(p));
          const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const events: PlugEvent[] = [];
          connected.forEach((p) => events.push({ type: 'connect', port: p, ts }));
          disconnected.forEach((p) => events.push({ type: 'disconnect', port: p, ts }));
          if (events.length > 0) {
            setPlugEvents((h) => [...events, ...h].slice(0, 20));
            events.forEach((e) => {
              if (e.type === 'connect') notify.info('设备已连接', `${e.port}`);
              else notify.warning('设备已断开', `${e.port}`);
            });
          }
        }
        prevPortsRef.current = currentPorts;
      } catch {
        /* 轮询失败静默 */
      }
    };
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [notify]);

  // 对每个设备查询驱动信息
  useEffect(() => {
    devices.forEach((d) => {
      if (d.vid != null && !driverMap[d.port]) {
        invoke<DriverInfo | null>('check_driver', { vid: d.vid, pid: d.pid }).then((info) => {
          if (info) setDriverMap((m) => ({ ...m, [d.port]: info }));
        }).catch(() => {});
      }
    });
  }, [devices, driverMap]);

  // #45 连接测试
  const testConnection = async (port: string) => {
    setTesting(port);
    try {
      const r = await invoke<ConnectionTestResult>('test_device_connection', { port, baud: 115200 });
      setTestResults((m) => ({ ...m, [port]: r }));
      if (r.can_open && r.has_response) notify.success('连接正常', `${port} 可打开且有数据响应`);
      else if (r.can_open) notify.info('端口可打开', `${port} 暂无数据响应（设备可能未输出）`);
      else notify.error('连接失败', r.error ?? '未知错误');
    } catch (e) {
      notify.error('测试失败', String(e));
    }
    setTesting(null);
  };

  return (
    <div className="devices-view">
      <div className="view-header">
        <h3>设备管理（{devices.length}）</h3>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? '扫描中…' : '🔄 刷新设备'}
        </Button>
      </div>

      {/* #43 热插拔事件流 */}
      {plugEvents.length > 0 && (
        <div className="plug-events">
          <span className="plug-events-label">🔌 热插拔事件：</span>
          {plugEvents.slice(0, 5).map((e, i) => (
            <span key={i} className={`plug-event plug-${e.type}`}>
              {e.type === 'connect' ? '➕' : '➖'} {e.port} <span className="plug-ts">{e.ts}</span>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="devices-grid">
          {Array.from({ length: 2 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : devices.length === 0 ? (
        <EmptyState
          icon="🔌"
          title="未检测到设备"
          description="请连接 ESP32 开发板后刷新设备列表。常见原因：①USB 数据线不支持数据传输；②CH343/CP210x 驱动未安装；③设备被其他串口工具占用。"
          actions={[
            { label: '刷新设备', onClick: onRefresh },
            { label: '返回开发', onClick: onGoDevelop },
          ]}
        />
      ) : (
        <div className="devices-grid">
          {devices.map((d) => (
            <Card key={d.port} interactive className={`device-card ${selectedPort === d.port ? 'selected' : ''}`}>
              <div className="device-card-header">
                <div className="device-port-wrap">
                  <span className="device-port">{d.port}</span>
                  {/* #51 设备别名 */}
                  {aliases[d.port] && editingAlias !== d.port && (
                    <span className="device-alias" title="自定义别名">{aliases[d.port]}</span>
                  )}
                </div>
                {editingAlias === d.port ? (
                  <div className="alias-edit" onClick={(e) => e.stopPropagation()}>
                    <input value={aliasValue} onChange={(e) => setAliasValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(d.port, aliasValue); if (e.key === 'Escape') setEditingAlias(null); }}
                      placeholder="输入别名" autoFocus />
                    <IconButton label="确认" onClick={() => saveAlias(d.port, aliasValue)}>✓</IconButton>
                    <IconButton label="取消" onClick={() => setEditingAlias(null)}>✕</IconButton>
                  </div>
                ) : (
                  <div className="device-card-header-right">
                    {d.detected ? <Badge tone="success">✓ 已识别</Badge> : <Badge tone="warning">⚠ 未识别</Badge>}
                    {/* #51 别名编辑 */}
                    <IconButton label="设置别名" onClick={(e) => { e.stopPropagation(); setEditingAlias(d.port); setAliasValue(aliases[d.port] ?? ''); }}>🏷</IconButton>
                  </div>
                )}
              </div>
              <div className="device-card-body">
                {d.chip && <div className="device-field"><span>芯片</span><strong>{d.chip}</strong></div>}
                {d.mac && <div className="device-field"><span>MAC</span><strong className="mono">{d.mac}</strong></div>}
                {d.flash_size && <div className="device-field"><span>Flash</span><strong>{d.flash_size}</strong></div>}
                {d.product && <div className="device-field"><span>产品</span><strong>{d.product}</strong></div>}
                {d.vid != null && (
                  <div className="device-field"><span>VID:PID</span><strong className="mono">0x{d.vid.toString(16)}:0x{d.pid?.toString(16) ?? '?'}</strong></div>
                )}
                {/* #52 驱动检测 */}
                {driverMap[d.port] && (
                  <div className="device-field">
                    <span>驱动</span>
                    <Badge tone="info" title={driverMap[d.port].hint}>{driverMap[d.port].driver}</Badge>
                  </div>
                )}
                {/* #45 连接测试结果 */}
                {testResults[d.port] && (
                  <div className="device-field">
                    <span>连接</span>
                    {testResults[d.port].can_open
                      ? <Badge tone={testResults[d.port].has_response ? 'success' : 'info'}>可打开{testResults[d.port].has_response ? '·有响应' : '·无响应'}</Badge>
                      : <Badge tone="danger" title={testResults[d.port].error ?? ''}>失败</Badge>}
                  </div>
                )}
              </div>
              {/* #47 识别失败引导 */}
              {!d.detected && (
                <div className="device-hint">
                  未识别为 ESP 设备。可能原因：非 ESP 板、esptool 未安装、或端口被占用。
                  {driverMap[d.port] && <div className="device-hint-detail">{driverMap[d.port].hint}</div>}
                </div>
              )}
              {/* #48 占用冲突提示 */}
              {testResults[d.port] && !testResults[d.port].can_open && testResults[d.port].error?.includes('占用') && (
                <div className="device-hint device-hint-warn">⚠ {testResults[d.port].error}</div>
              )}
              <div className="device-card-actions">
                <Button variant="secondary" size="sm" onClick={() => testConnection(d.port)} loading={testing === d.port}>
                  🔗 测试连接
                </Button>
                <Button variant="primary" size="sm" onClick={() => { onSelect(d.port, d.chip); onGoDevelop(); }} disabled={!d.detected}>
                  选为开发设备
                </Button>
                <IconButton label="串口监控" onClick={onGoMonitor}>📡</IconButton>
                <IconButton label="详情" onClick={() => setExpanded(expanded === d.port ? null : d.port)}>ℹ</IconButton>
              </div>
              {expanded === d.port && (
                <div className="device-detail">
                  <div className="device-field"><span>厂商</span><strong>{d.manufacturer ?? '-'}</strong></div>
                  <div className="device-field"><span>序列号</span><strong className="mono">{d.serial_number ?? '-'}</strong></div>
                  {driverMap[d.port] && (
                    <div className="device-field"><span>厂商(驱动)</span><strong>{driverMap[d.port].vendor}</strong></div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
