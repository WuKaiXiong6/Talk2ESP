// 文件路径：src/views/MonitorView.tsx
// 文件作用：串口监控视图——输出时间戳/着色/搜索/暂停/清空/导出 + 波特率预设 + 发送区历史 + 状态实时 + 完整串口参数
// 最后更新时间：2026-06-28-1245

import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Button, Badge, IconButton } from '../components/ui';
import { useNotifications } from '../components/notifications';
import './MonitorView.css';

/// 单行串口输出（含时间戳与来源）
interface SerialLineItem {
  id: number;
  text: string;
  timestamp: string;
  raw: boolean;
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

export function MonitorView() {
  const notify = useNotifications();
  const [port, setPort] = useState('');
  const [baud, setBaud] = useState(115200);
  // #40 完整串口参数（默认 8N1，保持现状）
  const [dataBits, setDataBits] = useState(8);
  const [stopBits, setStopBits] = useState('1');
  const [parity, setParity] = useState('none');
  const [lines, setLines] = useState<SerialLineItem[]>([]);
  const [sendText, setSendText] = useState('');
  // #36 发送区历史
  const [sendHistory, setSendHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // #34 暂停滚动
  const [paused, setPaused] = useState(false);
  // #33 搜索过滤
  const [search, setSearch] = useState('');
  // #37 自动换行 vs 原始
  const [autoScroll, setAutoScroll] = useState(true);
  const [active, setActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // 暂停期间缓冲的行
  const pausedBufferRef = useRef<SerialLineItem[]>([]);

  // 自动滚动到底部（除非暂停或关闭自动滚动）
  useEffect(() => {
    if (autoScroll && !paused) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, autoScroll, paused]);

  const start = async () => {
    if (!port.trim()) {
      notify.warning('请输入端口', '如 COM4 或 /dev/ttyUSB0');
      return;
    }
    setLines([]);
    pausedBufferRef.current = [];
    const ch = new Channel<{ port: string; text: string; raw: boolean }>();
    ch.onmessage = (msg) => {
      const item: SerialLineItem = {
        id: lineIdCounter++,
        text: msg.text,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        raw: msg.raw,
      };
      if (paused) {
        // 暂停时缓冲，恢复时一次性追加
        pausedBufferRef.current.push(item);
      } else {
        setLines((l) => [...l.slice(-2000), item]); // 保留最近2000行防内存膨胀
      }
    };
    try {
      // #40 传入完整串口参数（后端默认忽略新参数保持兼容）
      await invoke('start_monitor', {
        port, baud,
        dataBits, stopBits, parity,
        onLine: ch,
      });
      setActive(true);
      notify.success('串口已打开', `${port} @ ${baud} ${dataBits}${parity[0].toUpperCase()}${stopBits}`);
    } catch (e) {
      notify.error('打开串口失败', String(e));
      setLines([{ id: lineIdCounter++, text: `错误: ${e}`, timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }), raw: false }]);
    }
  };

  const stop = async () => {
    try {
      await invoke('stop_monitor', { port });
    } catch {
      /* 忽略停止错误 */
    }
    setActive(false);
    notify.info('串口已关闭', port);
  };

  const send = async () => {
    if (!sendText.trim() || !active) return;
    try {
      await invoke('send_serial', { port, data: sendText });
      // #36 记录发送历史（去重，最近20条）
      setSendHistory((h) => [sendText, ...h.filter((s) => s !== sendText)].slice(0, 20));
      setSendText('');
    } catch (e) {
      notify.error('发送失败', String(e));
    }
  };

  // #34 恢复滚动时把缓冲的行追加
  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      if (!next && pausedBufferRef.current.length > 0) {
        setLines((l) => [...l.slice(-2000), ...pausedBufferRef.current]);
        pausedBufferRef.current = [];
      }
      return next;
    });
  };

  // #35 清空
  const clear = () => {
    setLines([]);
    pausedBufferRef.current = [];
  };

  // #42 导出（txt）
  const exportTxt = () => {
    const content = lines.map((l) => `[${l.timestamp}] ${l.text}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serial_${port}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('已导出', `${lines.length} 行输出已保存为 txt`);
  };

  // #42 导出（csv）
  const exportCsv = () => {
    const content = ['timestamp,text,raw', ...lines.map((l) => `"${l.timestamp}","${l.text.replace(/"/g, '""')}",${l.raw}`)].join('\n');
    const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `serial_${port}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('已导出', `${lines.length} 行输出已保存为 csv`);
  };

  // #33 搜索过滤
  const filteredLines = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.toLowerCase();
    return lines.filter((l) => l.text.toLowerCase().includes(q));
  }, [lines, search]);

  return (
    <div className="monitor-view">
      <div className="monitor-controls ui-card">
        <div className="control-row">
          <label>端口:</label>
          <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="COM4" disabled={active} />
          <label>波特率:</label>
          <select value={baud} onChange={(e) => setBaud(+e.target.value)} disabled={active}>
            {BAUD_PRESETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)} disabled={active}>
            {showAdvanced ? '收起高级' : '高级参数'}
          </Button>
          {!active ? (
            <Button variant="primary" size="sm" onClick={start}>打开监控</Button>
          ) : (
            <Button variant="danger" size="sm" onClick={stop}>关闭监控</Button>
          )}
          {/* #37 状态实时显示 */}
          {active ? <Badge tone="success">● 监控中</Badge> : <Badge tone="default">○ 已停止</Badge>}
        </div>

        {/* #40 完整串口参数 */}
        {showAdvanced && (
          <div className="control-row advanced-params">
            <label>数据位:</label>
            <select value={dataBits} onChange={(e) => setDataBits(+e.target.value)} disabled={active}>
              {DATA_BITS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <label>校验位:</label>
            <select value={parity} onChange={(e) => setParity(e.target.value)} disabled={active}>
              {PARITY.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <label>停止位:</label>
            <select value={stopBits} onChange={(e) => setStopBits(e.target.value)} disabled={active}>
              {STOP_BITS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* #33 搜索 + #34 暂停 + #35 清空 + #42 导出 + #37 自动滚动 */}
      <div className="monitor-toolbar">
        <input
          className="monitor-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索过滤输出…"
        />
        <div className="monitor-toolbar-actions">
          <IconButton label={autoScroll ? '关闭自动滚动' : '开启自动滚动'} onClick={() => setAutoScroll((v) => !v)}>
            {autoScroll ? '⤓' : '⤒'}
          </IconButton>
          <Button variant={paused ? 'primary' : 'secondary'} size="sm" onClick={togglePause}>
            {paused ? '▶ 继续' : '⏸ 暂停'}
          </Button>
          <Button variant="secondary" size="sm" onClick={clear}>🗑 清空</Button>
          <Button variant="secondary" size="sm" onClick={exportTxt} disabled={lines.length === 0}>📄 导出TXT</Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={lines.length === 0}>📊 导出CSV</Button>
        </div>
      </div>

      <div className="serial-output">
        {filteredLines.length === 0 ? (
          <div className="serial-empty">{active ? '等待数据…' : '打开监控后此处显示串口输出'}</div>
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

      {/* #36 发送区 + 历史 */}
      <div className="send-area ui-card">
        <div className="control-row">
          <input
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            placeholder="输入要发送的数据，回车发送"
            onKeyDown={(e) => e.key === 'Enter' && send()}
            disabled={!active}
          />
          <Button variant="secondary" size="sm" onClick={send} disabled={!active || !sendText.trim()}>发送</Button>
          {sendHistory.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}>
              🕘 历史 ({sendHistory.length})
            </Button>
          )}
        </div>
        {showHistory && sendHistory.length > 0 && (
          <div className="send-history">
            {sendHistory.map((s, i) => (
              <button key={i} className="send-history-item" onClick={() => { setSendText(s); setShowHistory(false); }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
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
