// 文件路径：src/views/DevicesView.tsx
// 文件作用：设备管理视图——设备卡片化 + 详情 + 热插拔感知 + 识别失败引导 + 占用冲突 + 连接测试 + 驱动检测 + 固件信息解析(#49) + i18n
// 最后更新时间：2026-06-29-0230

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo, DriverInfo, ConnectionTestResult } from '../types';
import { Button, Badge, Card, IconButton } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { useNotifications } from '../components/notifications';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
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

  // #49 读取设备固件信息：解析关键字段结构化展示 + 保留原始输出
  const [readingFw, setReadingFw] = useState<string | null>(null);
  const [fwInfo, setFwInfo] = useState<{ port: string; raw: string; parsed: Record<string, string> } | null>(null);
  const readFirmware = async (port: string) => {
    setReadingFw(port);
    setFwInfo(null);
    try {
      const info = await invoke<string>('read_firmware_info', { port });
      // 启发式解析 esptool image_info 输出的常见字段
      const parsed: Record<string, string> = {};
      for (const line of info.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z][\w\s/]+?)\s*:\s*(.+)$/);
        if (m) {
          const key = m[1].trim();
          const val = m[2].trim();
          if (/image size|entry|app name|version|secure|hash|chip/i.test(key)) {
            parsed[key] = val;
          }
        }
      }
      setFwInfo({ port, raw: info, parsed });
      notify.success(`${port} 固件信息已读取`, Object.keys(parsed).length > 0 ? `${Object.keys(parsed).length} 个关键字段` : '查看原始输出');
    } catch (e) {
      notify.error('固件信息读取失败', String(e));
    }
    setReadingFw(null);
  };

  return (
    <div className="devices-view">
      <div className="view-header">
        <h3>{t('dev2.title')}（{devices.length}）</h3>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? t('dev2.scanning') : t('dev2.refreshShort')}
        </Button>
      </div>

      {/* #43 热插拔事件流 */}
      {plugEvents.length > 0 && (
        <div className="plug-events">
          <span className="plug-events-label">{t('dev2.plugEvents')}</span>
          {plugEvents.slice(0, 5).map((e, i) => (
            <span key={i} className={`plug-event plug-${e.type}`}>
              {e.type === 'connect' ? t('dev2.plugConnect') : t('dev2.plugDisconnect')} {e.port} <span className="plug-ts">{e.ts}</span>
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
          title={t('dev2.emptyTitle')}
          description={t('dev2.emptyDescLong')}
          actions={[
            { label: t('dev2.refreshBtn'), onClick: onRefresh },
            { label: t('dev2.backDevelop'), onClick: onGoDevelop },
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
                    <span className="device-alias" title={t('dev2.alias')}>{aliases[d.port]}</span>
                  )}
                </div>
                {editingAlias === d.port ? (
                  <div className="alias-edit" onClick={(e) => e.stopPropagation()}>
                    <input value={aliasValue} onChange={(e) => setAliasValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveAlias(d.port, aliasValue); if (e.key === 'Escape') setEditingAlias(null); }}
                      placeholder={t('dev2.aliasPlaceholder')} autoFocus />
                    <IconButton label={t('btn.confirm')} onClick={() => saveAlias(d.port, aliasValue)}>✓</IconButton>
                    <IconButton label={t('btn.cancel')} onClick={() => setEditingAlias(null)}>✕</IconButton>
                  </div>
                ) : (
                  <div className="device-card-header-right">
                    {d.detected ? <Badge tone="success">{t('dev2.identifyOk')}</Badge> : <Badge tone="warning">{t('dev2.identifyWarn')}</Badge>}
                    {/* #51 别名编辑 */}
                    <IconButton label={t('dev2.setAlias')} onClick={(e) => { e.stopPropagation(); setEditingAlias(d.port); setAliasValue(aliases[d.port] ?? ''); }}>🏷</IconButton>
                  </div>
                )}
              </div>
              <div className="device-card-body">
                {d.chip && <div className="device-field"><span>{t('dev2.fChip')}</span><strong>{d.chip}</strong></div>}
                {d.mac && <div className="device-field"><span>{t('dev2.fMac')}</span><strong className="mono">{d.mac}</strong></div>}
                {d.flash_size && <div className="device-field"><span>{t('dev2.fFlash')}</span><strong>{d.flash_size}</strong></div>}
                {d.product && <div className="device-field"><span>{t('dev2.fProduct')}</span><strong>{d.product}</strong></div>}
                {d.vid != null && (
                  <div className="device-field"><span>{t('dev2.fVidPid')}</span><strong className="mono">0x{d.vid.toString(16)}:0x{d.pid?.toString(16) ?? '?'}</strong></div>
                )}
                {/* #52 驱动检测 */}
                {driverMap[d.port] && (
                  <div className="device-field">
                    <span>{t('dev2.fDriver')}</span>
                    <Badge tone="info" title={driverMap[d.port].hint}>{driverMap[d.port].driver}</Badge>
                  </div>
                )}
                {/* #45 连接测试结果 */}
                {testResults[d.port] && (
                  <div className="device-field">
                    <span>{t('dev2.fConn')}</span>
                    {testResults[d.port].can_open
                      ? <Badge tone={testResults[d.port].has_response ? 'success' : 'info'}>{t('dev2.connCanOpen')}{testResults[d.port].has_response ? t('dev2.connHasResp') : t('dev2.connNoResp')}</Badge>
                      : <Badge tone="danger" title={testResults[d.port].error ?? ''}>{t('dev2.connFailedBadge')}</Badge>}
                  </div>
                )}
              </div>
              {/* #47 识别失败引导 */}
              {!d.detected && (
                <div className="device-hint">
                  {t('dev2.notEspHint')}
                  {driverMap[d.port] && <div className="device-hint-detail">{driverMap[d.port].hint}</div>}
                </div>
              )}
              {/* #48 占用冲突提示 */}
              {testResults[d.port] && !testResults[d.port].can_open && testResults[d.port].error?.includes('占用') && (
                <div className="device-hint device-hint-warn">⚠ {testResults[d.port].error}</div>
              )}
              <div className="device-card-actions">
                <Button variant="secondary" size="sm" onClick={() => testConnection(d.port)} loading={testing === d.port}>
                  {t('dev2.testConn')}
                </Button>
                {/* #49 读取固件信息 */}
                <Button variant="ghost" size="sm" onClick={() => readFirmware(d.port)} loading={readingFw === d.port}>
                  {t('dev2.firmware')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => { onSelect(d.port, d.chip); onGoDevelop(); }} disabled={!d.detected}>
                  {t('dev2.selectDev')}
                </Button>
                <IconButton label={t('dev2.monitorTitle')} onClick={onGoMonitor}>📡</IconButton>
                <IconButton label={t('dev2.detailTitle')} onClick={() => setExpanded(expanded === d.port ? null : d.port)}>ℹ</IconButton>
              </div>
              {/* #49 固件信息结构化展示 */}
              {fwInfo?.port === d.port && (
                <div className="fw-info">
                  {Object.keys(fwInfo.parsed).length > 0 ? (
                    <dl className="fw-fields">
                      {Object.entries(fwInfo.parsed).map(([k, v]) => (
                        <div key={k} className="fw-field"><dt>{k}</dt><dd>{v}</dd></div>
                      ))}
                    </dl>
                  ) : (
                    <pre className="fw-raw">{fwInfo.raw.slice(0, 500)}</pre>
                  )}
                </div>
              )}
              {expanded === d.port && (
                <div className="device-detail">
                  <div className="device-field"><span>{t('dev2.vendor')}</span><strong>{d.manufacturer ?? '-'}</strong></div>
                  <div className="device-field"><span>{t('dev2.serial')}</span><strong className="mono">{d.serial_number ?? '-'}</strong></div>
                  {driverMap[d.port] && (
                    <div className="device-field"><span>{t('dev2.driverVendor')}</span><strong>{driverMap[d.port].vendor}</strong></div>
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
