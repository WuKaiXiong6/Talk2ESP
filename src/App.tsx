// 文件路径：src/App.tsx
// 文件作用：M0 骨架验证页，展示串口列表 + Channel 流式通信测试
// 最后更新时间：2026-06-28-0332

import { useEffect, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { PortInfo } from './types/port';

function App() {
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ticks, setTicks] = useState<number[]>([]);
  const [tickDone, setTickDone] = useState(false);

  const refresh = async () => {
    try {
      const list = await invoke<PortInfo[]>('scan_ports');
      setPorts(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const startTick = async () => {
    setTicks([]);
    setTickDone(false);
    const ch = new Channel<{ event: string; data: { count?: number } }>();
    ch.onmessage = (msg) => {
      if (msg.event === 'Tick' && msg.data.count != null) {
        setTicks((t) => [...t, msg.data.count as number]);
      }
      if (msg.event === 'Done') setTickDone(true);
    };
    await invoke('start_tick', { onEvent: ch });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Talk2ESP — M0 骨架验证</h1>

      <h2>检测到的串口（{ports.length}）</h2>
      <button onClick={refresh}>刷新串口</button>
      {error && <p style={{ color: 'red' }}>错误：{error}</p>}
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>端口</th><th>VID</th><th>PID</th><th>产品</th><th>厂商</th><th>序列号</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>{p.vid ? `0x${p.vid.toString(16).toUpperCase()}` : '-'}</td>
              <td>{p.pid ? `0x${p.pid.toString(16).toUpperCase()}` : '-'}</td>
              <td>{p.product ?? '-'}</td>
              <td>{p.manufacturer ?? '-'}</td>
              <td>{p.serial_number ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr />
      <h2>Channel 流式通信测试</h2>
      <button onClick={startTick}>开始 Tick</button>
      <p>收到：{ticks.join(', ')}</p>
      <p>{tickDone ? '完成' : '运行中…'}</p>
    </div>
  );
}

export default App;
