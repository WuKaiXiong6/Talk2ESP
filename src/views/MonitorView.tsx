// 文件路径：src/views/MonitorView.tsx
// 文件作用：串口监控视图——端口/波特率配置 + 输出显示 + 数据发送
// 最后更新时间：2026-06-28-1230

import { useEffect, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Button } from '../components/ui';

export function MonitorView() {
  const [port, setPort] = useState('');
  const [baud, setBaud] = useState(115200);
  const [lines, setLines] = useState<string[]>([]);
  const [sendText, setSendText] = useState('');
  const [active, setActive] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  const start = async () => {
    setLines([]);
    const ch = new Channel<{ port: string; text: string; raw: boolean }>();
    ch.onmessage = (msg) => setLines((l) => [...l, msg.text]);
    try {
      await invoke('start_monitor', { port, baud, onLine: ch });
      setActive(true);
    } catch (e) { setLines((l) => [...l, `错误: ${e}`]); }
  };

  const stop = async () => {
    await invoke('stop_monitor', { port });
    setActive(false);
  };

  const send = async () => {
    if (!sendText.trim()) return;
    await invoke('send_serial', { port, data: sendText });
    setSendText('');
  };

  return (
    <div className="monitor-view">
      <div className="control-row">
        <label>端口:</label>
        <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="COM4" />
        <label>波特率:</label>
        <input type="number" value={baud} onChange={(e) => setBaud(+e.target.value)} />
        {!active ? (
          <Button variant="primary" size="sm" onClick={start}>打开监控</Button>
        ) : (
          <Button variant="danger" size="sm" onClick={stop}>关闭监控</Button>
        )}
      </div>
      <div className="serial-output">
        {lines.map((l, i) => <div key={i}>{l}</div>)}
        <div ref={endRef} />
      </div>
      <div className="control-row">
        <input value={sendText} onChange={(e) => setSendText(e.target.value)}
          placeholder="输入要发送的数据" onKeyDown={(e) => e.key === 'Enter' && send()} />
        <Button variant="secondary" size="sm" onClick={send}>发送</Button>
      </div>
    </div>
  );
}
