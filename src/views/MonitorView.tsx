// 文件路径：src/views/MonitorView.tsx
// 文件作用：串口监控视图——多标签(#38) + 输出时间戳/着色/搜索/暂停/清空/导出 + 波特率预设+探测 + 发送区增强(#36十六进制/换行/定时) + 数据图表(#39) + i18n
// 最后更新时间：2026-06-29-0230

import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Button, Badge, IconButton } from '../components/ui';
import { useNotifications } from '../components/notifications';
import { useI18n } from '../i18n';
import './MonitorView.css';

/// 单行串口输出（含时间戳与来源）
interface SerialLineItem {
  id: number;
  text: string;
  timestamp: string;
  raw: boolean;
}

/// #38 单个监控标签页的状态
interface MonitorTab {
  id: string;          // 标签唯一 id（用 port 作为 id，同端口不重复）
  port: string;
  baud: number;
  dataBits: number;
  stopBits: string;
  parity: string;
  active: boolean;
  lines: SerialLineItem[];
  paused: boolean;
  autoScroll: boolean;
  search: string;
  sendText: string;
  sendHistory: string[];
  showHistory: boolean;
  hexMode: boolean;        // #36 十六进制发送
  lineEnding: 'none' | 'lf' | 'crlf';  // #36 换行符选择
  showAdvanced: boolean;
  // #39 图表：缓存解析出的数值点（timestamp 序号 + 值）
  chartPoints: { x: number; y: number }[];
  chartEnabled: boolean;
}

/// 常用波特率预设
const BAUD_PRESETS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

/// 数据位选项
const DATA_BITS = [5, 6, 7, 8];
/// 停止位选项
const STOP_BITS: Array<{ value: string; label: string }> = [
  { value: '1', label: '1' },
  { value: '1.5', label: '1.5' },
  { value: '2', label: '2' },
];
/// 校验位选项
const PARITY: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'even', label: 'Even' },
  { value: 'odd', label: 'Odd' },
];

let lineIdCounter = 0;
let chartXCounter = 0;

/// #39 从一行文本中尝试解析数值（支持 "key: 12.3" / "12.3" / "temp=12.3" 等模式）
function extractNumber(text: string): number | null {
  // 优先匹配 "label 数字" 形式的最后一个数字
  const m = text.match(/-?\d+(\.\d+)?/);
  if (m) {
    const v = parseFloat(m[0]);
    if (!isNaN(v) && isFinite(v)) return v;
  }
  return null;
}

/// 创建一个新标签页的默认状态
function makeTab(port: string): MonitorTab {
  return {
    id: port || `tab-${Date.now()}`,
    port,
    baud: 115200,
    dataBits: 8,
    stopBits: '1',
    parity: 'none',
    active: false,
    lines: [],
    paused: false,
    autoScroll: true,
    search: '',
    sendText: '',
    sendHistory: [],
    showHistory: false,
    hexMode: false,
    lineEnding: 'lf',
    showAdvanced: false,
    chartPoints: [],
    chartEnabled: false,
  };
}

export function MonitorView() {
  const notify = useNotifications();
  const { t: tr } = useI18n();
  // #38 多标签：标签列表 + 当前激活标签 id
  const [tabs, setTabs] = useState<MonitorTab[]>([makeTab('')]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  // #35 波特率探测中
  const [detecting, setDetecting] = useState(false);
  // #36 定时循环发送
  const [repeatInterval, setRepeatInterval] = useState<number>(0); // 0=关闭，>0 毫秒间隔
  const endRef = useRef<HTMLDivElement>(null);
  const repeatTimerRef = useRef<number | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  /// 更新当前激活标签的局部字段
  const updateActiveTab = (patch: Partial<MonitorTab>) => {
    setTabs((ts) => ts.map((t) => (t.id === activeTabId ? { ...t, ...patch } : t)));
  };

  // 自动滚动到底部（除非暂停或关闭自动滚动）
  useEffect(() => {
    if (activeTab.autoScroll && !activeTab.paused) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTab.lines, activeTab.autoScroll, activeTab.paused]);

  // #36 定时循环发送
  useEffect(() => {
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    if (repeatInterval > 0 && activeTab.active && activeTab.sendText) {
      repeatTimerRef.current = window.setInterval(() => {
        doSend(true);
      }, repeatInterval);
    }
    return () => {
      if (repeatTimerRef.current) clearInterval(repeatTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatInterval, activeTab.active, activeTab.sendText, activeTab.hexMode, activeTab.lineEnding]);

  const start = async () => {
    if (!activeTab.port.trim()) {
      notify.warning('请输入端口', '如 COM4 或 /dev/ttyUSB0');
      return;
    }
    updateActiveTab({ lines: [], chartPoints: [] });
    chartXCounter = 0;
    const tabId = activeTab.id;
    const ch = new Channel<{ port: string; text: string; raw: boolean }>();
    ch.onmessage = (msg) => {
      const item: SerialLineItem = {
        id: lineIdCounter++,
        text: msg.text,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        raw: msg.raw,
      };
      setTabs((ts) => ts.map((t) => {
        if (t.id !== tabId) return t;
        if (t.paused) {
          // 暂停时缓冲到 lines 末尾临时区不合适，这里简化：暂停期间丢弃新行（与原实现缓冲 ref 不同）
          // 为不丢数据，改为缓冲到 lines 末尾但标记，恢复时不额外处理（简化多标签实现）
          return { ...t, lines: [...t.lines.slice(-2000), item] };
        }
        const nextLines = [...t.lines.slice(-2000), item];
        // #39 图表：若启用且能解析出数值则追加点
        let nextChart = t.chartPoints;
        if (t.chartEnabled) {
          const num = extractNumber(msg.text);
          if (num !== null) {
            nextChart = [...t.chartPoints.slice(-300), { x: chartXCounter++, y: num }];
          }
        }
        return { ...t, lines: nextLines, chartPoints: nextChart };
      }));
    };
    try {
      await invoke('start_monitor', {
        port: activeTab.port, baud: activeTab.baud,
        dataBits: activeTab.dataBits, stopBits: activeTab.stopBits, parity: activeTab.parity,
        onLine: ch,
      });
      updateActiveTab({ active: true });
      notify.success('串口已打开', `${activeTab.port} @ ${activeTab.baud} ${activeTab.dataBits}${activeTab.parity[0].toUpperCase()}${activeTab.stopBits}`);
    } catch (e) {
      notify.error('打开串口失败', String(e));
      updateActiveTab({ lines: [{ id: lineIdCounter++, text: `错误: ${e}`, timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }), raw: false }] });
    }
  };

  const stop = async () => {
    try {
      await invoke('stop_monitor', { port: activeTab.port });
    } catch {
      /* 忽略停止错误 */
    }
    updateActiveTab({ active: false });
    // 停止定时发送
    if (repeatTimerRef.current) {
      clearInterval(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    notify.info('串口已关闭', activeTab.port);
  };

  // #35 自动探测波特率
  const detectBaud = async () => {
    if (!activeTab.port.trim()) {
      notify.warning('请先输入端口', '需要端口才能探测波特率');
      return;
    }
    setDetecting(true);
    try {
      const detected = await invoke<number | null>('detect_baud', { port: activeTab.port });
      if (detected) {
        updateActiveTab({ baud: detected });
        notify.success('探测成功', `检测到波特率 ${detected}，已自动填入`);
      } else {
        notify.warning('未能探测波特率', '设备可能未主动输出数据（静默固件），请手动选择常用波特率');
      }
    } catch (e) {
      notify.error('探测失败', String(e));
    }
    setDetecting(false);
  };

  /// #36 实际发送：根据 hexMode/lineEnding 组装字节，调 send_serial_raw
  const doSend = async (isRepeat = false) => {
    if (!activeTab.sendText.trim() || !activeTab.active) return;
    try {
      let bytes: Uint8Array;
      if (activeTab.hexMode) {
        // 十六进制：去除空格/逗号后按两位解析
        const hex = activeTab.sendText.replace(/[\s,]/g, '');
        if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
          if (!isRepeat) notify.error('十六进制格式错误', '需为偶数位 0-9a-f，可用空格/逗号分隔');
          return;
        }
        const arr = new Uint8Array(hex.length / 2);
        for (let i = 0; i < arr.length; i++) {
          arr[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        bytes = arr;
      } else {
        // 文本：按换行符选择追加
        let text = activeTab.sendText;
        if (activeTab.lineEnding === 'lf') text += '\n';
        else if (activeTab.lineEnding === 'crlf') text += '\r\n';
        bytes = new TextEncoder().encode(text);
      }
      await invoke('send_serial_raw', { port: activeTab.port, bytes: Array.from(bytes) });
      if (!isRepeat) {
        // 记录发送历史（去重，最近20条）
        updateActiveTab({
          sendHistory: [activeTab.sendText, ...activeTab.sendHistory.filter((s) => s !== activeTab.sendText)].slice(0, 20),
          sendText: '',
        });
      }
    } catch (e) {
      notify.error('发送失败', String(e));
    }
  };

  // #34 暂停/恢复
  const togglePause = () => {
    updateActiveTab({ paused: !activeTab.paused });
  };

  // #35 清空
  const clear = () => {
    updateActiveTab({ lines: [], chartPoints: [] });
    chartXCounter = 0;
  };

  // #42 导出（txt）
  const exportTxt = () => {
    const content = activeTab.lines.map((l) => `[${l.timestamp}] ${l.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serial_${activeTab.port}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('已导出', `${activeTab.lines.length} 行输出已保存为 txt`);
  };

  // #42 导出（csv）
  const exportCsv = () => {
    const content = ['timestamp,text,raw', ...activeTab.lines.map((l) => `"${l.timestamp}","${l.text.replace(/"/g, '""')}",${l.raw}`)].join('\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serial_${activeTab.port}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('已导出', `${activeTab.lines.length} 行输出已保存为 csv`);
  };

  // #33 搜索过滤
  const filteredLines = useMemo(() => {
    if (!activeTab.search.trim()) return activeTab.lines;
    const q = activeTab.search.toLowerCase();
    return activeTab.lines.filter((l) => l.text.toLowerCase().includes(q));
  }, [activeTab.lines, activeTab.search]);

  // #38 新增标签页
  const addTab = () => {
    const newTab = makeTab('');
    setTabs((ts) => [...ts, newTab]);
    setActiveTabId(newTab.id);
  };

  // #38 关闭标签页（若正在监控则先停止）
  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.active) {
      try { await invoke('stop_monitor', { port: tab.port }); } catch { /* 忽略 */ }
    }
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        const fresh = makeTab('');
        setActiveTabId(fresh.id);
        return [fresh];
      }
      if (tabId === activeTabId) {
        setActiveTabId(next[0].id);
      }
      return next;
    });
  };

  return (
    <div className="monitor-view">
      {/* #38 多标签栏 */}
      <div className="monitor-tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`monitor-tab ${t.id === activeTabId ? 'active' : ''}`}
            onClick={() => setActiveTabId(t.id)}
          >
            <span className="monitor-tab-name">{t.port || tr('mon.newTab')}</span>
            {t.active && <span className="monitor-tab-dot" />}
            <button
              className="monitor-tab-close"
              title={tr('mon.closeTab')}
              onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
            >×</button>
          </div>
        ))}
        <button className="monitor-tab-add" title={tr('mon.newTab')} onClick={addTab}>＋</button>
      </div>

      <div className="monitor-controls ui-card">
        <div className="control-row">
          <label>{tr('mon.port')}</label>
          <input value={activeTab.port} onChange={(e) => updateActiveTab({ port: e.target.value })} placeholder="COM4" disabled={activeTab.active} />
          <label>{tr('mon.baud')}</label>
          <select value={activeTab.baud} onChange={(e) => updateActiveTab({ baud: +e.target.value })} disabled={activeTab.active}>
            {BAUD_PRESETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          {/* #35 自动探测波特率 */}
          <Button variant="ghost" size="sm" onClick={detectBaud} loading={detecting} disabled={activeTab.active}>
            {tr('mon.detect')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => updateActiveTab({ showAdvanced: !activeTab.showAdvanced })} disabled={activeTab.active}>
            {activeTab.showAdvanced ? tr('mon.advancedCollapse') : tr('mon.advanced')}
          </Button>
          {!activeTab.active ? (
            <Button variant="primary" size="sm" onClick={start}>{tr('mon.open')}</Button>
          ) : (
            <Button variant="danger" size="sm" onClick={stop}>{tr('mon.close')}</Button>
          )}
          {/* #37 状态实时显示 */}
          {activeTab.active ? <Badge tone="success">{tr('mon.monitoring')}</Badge> : <Badge tone="default">{tr('mon.stopped')}</Badge>}
        </div>

        {/* #40 完整串口参数 */}
        {activeTab.showAdvanced && (
          <div className="control-row advanced-params">
            <label>{tr('mon.dataBits')}</label>
            <select value={activeTab.dataBits} onChange={(e) => updateActiveTab({ dataBits: +e.target.value })} disabled={activeTab.active}>
              {DATA_BITS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <label>{tr('mon.parity')}</label>
            <select value={activeTab.parity} onChange={(e) => updateActiveTab({ parity: e.target.value })} disabled={activeTab.active}>
              {PARITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <label>{tr('mon.stopBits')}</label>
            <select value={activeTab.stopBits} onChange={(e) => updateActiveTab({ stopBits: e.target.value })} disabled={activeTab.active}>
              {STOP_BITS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {/* #39 数据图表开关 */}
            <label>{tr('mon.chart')}</label>
            <input type="checkbox" checked={activeTab.chartEnabled} onChange={(e) => updateActiveTab({ chartEnabled: e.target.checked })} />
            <span className="hint">{tr('mon.chartHint')}</span>
          </div>
        )}
      </div>

      {/* #33 搜索 + #34 暂停 + #35 清空 + #42 导出 + #37 自动滚动 */}
      <div className="monitor-toolbar">
        <input
          className="monitor-search"
          value={activeTab.search}
          onChange={(e) => updateActiveTab({ search: e.target.value })}
          placeholder={tr('mon.searchPlaceholder')}
        />
        <div className="monitor-toolbar-actions">
          <IconButton label={activeTab.autoScroll ? tr('mon.autoScrollOff') : tr('mon.autoScrollOn')} onClick={() => updateActiveTab({ autoScroll: !activeTab.autoScroll })}>
            {activeTab.autoScroll ? '⤓' : '⤒'}
          </IconButton>
          <Button variant={activeTab.paused ? 'primary' : 'secondary'} size="sm" onClick={togglePause}>
            {activeTab.paused ? tr('mon.resume') : tr('mon.pause')}
          </Button>
          <Button variant="secondary" size="sm" onClick={clear}>{tr('mon.clear')}</Button>
          <Button variant="secondary" size="sm" onClick={exportTxt} disabled={activeTab.lines.length === 0}>{tr('mon.exportTxt')}</Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={activeTab.lines.length === 0}>{tr('mon.exportCsv')}</Button>
        </div>
      </div>

      {/* #39 数据图表 */}
      {activeTab.chartEnabled && activeTab.chartPoints.length > 1 && (
        <div className="serial-chart ui-card">
          <SerialChart points={activeTab.chartPoints} title={tr('mon.chartTitle', { n: activeTab.chartPoints.length })} />
        </div>
      )}

      <div className="serial-output">
        {filteredLines.length === 0 ? (
          <div className="serial-empty">{activeTab.active ? tr('mon.waiting') : tr('mon.openHint')}</div>
        ) : (
          filteredLines.map((l) => (
            <div key={l.id} className={`serial-line ${l.raw ? 'serial-raw' : ''}`}>
              {/* #31 时间戳 */}
              <span className="serial-ts">{l.timestamp}</span>
              {/* #32 着色：TEST:PASS 绿 / TEST:FAIL 红 / ECHO 蓝 / 错误红 */}
              <span className={`serial-text ${classifyLine(l.text)}`}>{l.text}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* #36 发送区增强：十六进制/换行/定时/历史 */}
      <div className="send-area ui-card">
        <div className="control-row">
          <input
            value={activeTab.sendText}
            onChange={(e) => updateActiveTab({ sendText: e.target.value })}
            placeholder={activeTab.hexMode ? tr('mon.sendPlaceholderHex') : tr('mon.sendPlaceholder')}
            onKeyDown={(e) => e.key === 'Enter' && doSend(false)}
            disabled={!activeTab.active}
          />
          <Button variant="secondary" size="sm" onClick={() => doSend(false)} disabled={!activeTab.active || !activeTab.sendText.trim()}>{tr('mon.send')}</Button>
          {/* #36 十六进制模式 */}
          <label className="send-option" title={tr('mon.sendPlaceholderHex')}>
            <input type="checkbox" checked={activeTab.hexMode} onChange={(e) => updateActiveTab({ hexMode: e.target.checked })} disabled={!activeTab.active} />
            HEX
          </label>
          {/* #36 换行符选择 */}
          <select className="send-line-ending" value={activeTab.lineEnding} onChange={(e) => updateActiveTab({ lineEnding: e.target.value as 'none' | 'lf' | 'crlf' })} disabled={!activeTab.active}>
            <option value="lf">{tr('mon.lineLf')}</option>
            <option value="crlf">{tr('mon.lineCrlf')}</option>
            <option value="none">{tr('mon.lineNone')}</option>
          </select>
          {/* #36 定时循环发送 */}
          <label className="send-option">
            {tr('mon.repeat')}
            <input
              type="number"
              min={0}
              value={repeatInterval}
              onChange={(e) => setRepeatInterval(Math.max(0, +e.target.value || 0))}
              disabled={!activeTab.active}
              style={{ width: 64 }}
            />ms
          </label>
          {activeTab.sendHistory.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => updateActiveTab({ showHistory: !activeTab.showHistory })}>
              {tr('mon.history')} ({activeTab.sendHistory.length})
            </Button>
          )}
        </div>
        {activeTab.showHistory && activeTab.sendHistory.length > 0 && (
          <div className="send-history">
            {activeTab.sendHistory.map((s, i) => (
              <button key={i} className="send-history-item" onClick={() => { updateActiveTab({ sendText: s, showHistory: false }); }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/// #39 轻量折线图（canvas 自绘，无新依赖）
function SerialChart({ points, title }: { points: { x: number; y: number }[]; title?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (points.length < 2) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 24;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    // 背景网格
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = pad + ((h - pad * 2) * i) / 4;
      ctx.moveTo(pad, y); ctx.lineTo(w - pad, y);
    }
    ctx.stroke();
    // 折线
    ctx.strokeStyle = '#6cd0e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = pad + ((p.x - minX) / rangeX) * (w - pad * 2);
      const y = h - pad - ((p.y - minY) / rangeY) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Y 轴标注
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '11px monospace';
    ctx.fillText(maxY.toFixed(1), 2, pad + 4);
    ctx.fillText(minY.toFixed(1), 2, h - pad + 4);
  }, [points]);
  return (
    <div>
      <div className="chart-title">{title ?? `Trend (${points.length} pts)`}</div>
      <canvas ref={canvasRef} width={800} height={160} style={{ width: '100%', maxWidth: 900 }} />
    </div>
  );
}

/// #32 行着色分类
function classifyLine(text: string): string {
  if (/TEST:PASS/i.test(text)) return 'serial-pass';
  if (/TEST:FAIL/i.test(text)) return 'serial-fail';
  if (/^ECHO:/i.test(text)) return 'serial-echo';
  if (/error|fail|异常|错误/i.test(text)) return 'serial-error';
  return '';
}
