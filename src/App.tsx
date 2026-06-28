// 文件路径：src/App.tsx
// 文件作用：Talk2ESP 主界面——设备选择/需求输入/全自动流水线/实时日志/串口监控
// 最后更新时间：2026-06-28-1037

import { useEffect, useState, useRef } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type {
  DeviceInfo, RequirementSpec, PipelineEvent, PipelineOutcome, ConversationMessage, Project,
} from './types';
import './App.css';

type View = 'develop' | 'devices' | 'projects' | 'monitor';

function App() {
  const [view, setView] = useState<View>('develop');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [selectedChip, setSelectedChip] = useState<string>('esp32s3');
  const [chips, setChips] = useState<string[]>([]);
  const [requirement, setRequirement] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentState, setCurrentState] = useState<string>('');
  const [outcome, setOutcome] = useState<PipelineOutcome | null>(null);
  const [chatHistory, setChatHistory] = useState<ConversationMessage[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 初始化：扫描设备 + 加载芯片列表
  useEffect(() => {
    refreshDevices();
    invoke<string[]>('list_chips').then(setChips).catch(() => {});
  }, []);

  // 日志自动滚动
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const refreshDevices = async () => {
    try {
      const list = await invoke<DeviceInfo[]>('scan_devices');
      setDevices(list);
      const esp = list.find((d) => d.detected);
      if (esp) {
        setSelectedPort(esp.port);
        if (esp.chip) setSelectedChip(esp.chip);
      }
    } catch (e) {
      addLog(`设备扫描失败: ${e}`);
    }
  };

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs((l) => [...l, `[${ts}] ${msg}`]);
  };

  // 与 AI 对话澄清需求
  const chatWithAi = async () => {
    if (!requirement.trim()) return;
    setRunning(true);
    addLog(`向 AI 描述需求: ${requirement}`);
    const userMsg: ConversationMessage = {
      role: 'user', content: requirement, timestamp: new Date().toISOString(),
    };
    setChatHistory((h) => [...h, userMsg]);
    try {
      const reply = await invoke<string>('llm_chat', {
        messages: [
          { role: 'system', content: '你是 Talk2ESP 嵌入式开发助手，帮助用户澄清 ESP32 开发需求。简洁回复。' },
          { role: 'user', content: requirement },
        ],
      });
      const aiMsg: ConversationMessage = {
        role: 'assistant', content: reply, timestamp: new Date().toISOString(),
      };
      setChatHistory((h) => [...h, aiMsg]);
      addLog(`AI 回复: ${reply.slice(0, 80)}...`);
    } catch (e) {
      addLog(`AI 对话失败: ${e}`);
    }
    setRunning(false);
  };

  // 一键全自动开发：需求 → 流水线
  const runAutoPipeline = async () => {
    if (!requirement.trim()) { addLog('请先输入需求'); return; }
    if (!selectedPort) { addLog('请先选择设备'); return; }
    setRunning(true);
    setLogs([]);
    setOutcome(null);
    setCurrentState('coding');
    addLog(`启动全自动流水线 (端口=${selectedPort}, 芯片=${selectedChip})`);

    // 构造需求确认书（简化：从自然语言直接生成，实际可多轮澄清）
    const spec: RequirementSpec = {
      project_name: 'talk2esp_project',
      chip: selectedChip,
      peripherals: [{ type: 'GPIO_OUT', pin: 2, behavior: requirement }],
      expected_behavior: requirement,
      test_harness_expectation: {
        cases: [{ name: 'main', expect: 'TEST:PASS main' }],
      },
    };

    // 先让 AI 把自然语言转成结构化需求确认书
    try {
      addLog('AI 解析需求生成代码...');
      const code = await invoke<{ main_ino: string; explanation: string }>('llm_generate_code', { spec });
      addLog(`代码生成完成: ${code.explanation.slice(0, 60)}`);
    } catch (e) {
      addLog(`代码生成失败: ${e}`);
    }

    // 创建项目并运行全自动流水线
    try {
      const project = await invoke<{ id: string }>('create_project', {
        name: 'auto_' + Date.now(), chip: selectedChip,
      });
      addLog(`创建项目: ${project.id}`);

      const ch = new Channel<PipelineEvent>();
      ch.onmessage = (event) => {
        if (event.kind === 'StateChanged') {
          setCurrentState(event.data.state);
          addLog(`状态: ${event.data.state}`);
        } else if (event.kind === 'StageLog') {
          addLog(`[${event.data.stage}] ${event.data.message}`);
        } else if (event.kind === 'ToolOutput') {
          setLogs((l) => [...l, `  ${event.data.line}`]);
        } else if (event.kind === 'Retry') {
          addLog(`重试 ${event.data.stage} (${event.data.attempt}/${event.data.max}): ${event.data.reason}`);
        } else if (event.kind === 'Done') {
          addLog(`完成: ${event.data.summary}`);
        }
      };

      const result = await invoke<PipelineOutcome>('run_full_pipeline', {
        spec, port: selectedPort, projectId: project.id, onEvent: ch,
      });
      setOutcome(result);
      if (result.success) {
        addLog('✅ 全自动开发成功！');
      } else {
        addLog(`❌ 失败: ${result.summary}`);
      }
    } catch (e) {
      addLog(`流水线错误: ${e}`);
    }
    setRunning(false);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Talk2ESP</h1>
        <span className="subtitle">自然语言驱动的 ESP32 全自动开发</span>
      </header>

      <nav className="nav">
        <button className={view === 'develop' ? 'active' : ''} onClick={() => setView('develop')}>开发</button>
        <button className={view === 'devices' ? 'active' : ''} onClick={() => setView('devices')}>设备</button>
        <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>项目</button>
        <button className={view === 'monitor' ? 'active' : ''} onClick={() => setView('monitor')}>串口监控</button>
      </nav>

      <main className="main">
        {view === 'develop' && (
          <DevelopView
            devices={devices} selectedPort={selectedPort} selectedChip={selectedChip}
            chips={chips} requirement={requirement} running={running} currentState={currentState}
            chatHistory={chatHistory} logs={logs} outcome={outcome} logEndRef={logEndRef}
            onRefreshDevices={refreshDevices} onPort={setSelectedPort} onChip={setSelectedChip}
            onRequirement={setRequirement} onChat={chatWithAi} onRun={runAutoPipeline}
          />
        )}
        {view === 'devices' && <DevicesView devices={devices} onRefresh={refreshDevices} />}
        {view === 'projects' && <ProjectsView />}
        {view === 'monitor' && <MonitorView />}
      </main>
    </div>
  );
}

// ========== 开发视图 ==========
function DevelopView(props: any) {
  const { devices, selectedPort, selectedChip, chips, requirement, running, currentState,
    chatHistory, logs, outcome, logEndRef, onRefreshDevices, onPort, onChip,
    onRequirement, onChat, onRun } = props;

  const stateLabel: Record<string, string> = {
    coding: '生成代码', compiling: '编译中', flashing: '烧录中',
    verifying: '验证中', archived: '✅ 完成', failed: '❌ 失败',
  };

  return (
    <div className="develop-view">
      <div className="control-panel">
        <div className="control-row">
          <label>设备:</label>
          <select value={selectedPort} onChange={(e) => onPort(e.target.value)}>
            <option value="">选择串口…</option>
            {devices.map((d: DeviceInfo) => (
              <option key={d.port} value={d.port}>
                {d.port} {d.chip ? `(${d.chip})` : ''} {d.detected ? '✓' : ''}
              </option>
            ))}
          </select>
          <label>芯片:</label>
          <select value={selectedChip} onChange={(e) => onChip(e.target.value)}>
            {chips.map((c: string) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={onRefreshDevices} disabled={running}>刷新设备</button>
        </div>

        <div className="requirement-box">
          <label>描述你的需求（自然语言）:</label>
          <textarea
            value={requirement}
            onChange={(e) => onRequirement(e.target.value)}
            placeholder="例如：GPIO2 接 LED，每 500ms 闪烁一次，串口输出闪烁状态"
            rows={4}
            disabled={running}
          />
          <div className="btn-row">
            <button onClick={onChat} disabled={running || !requirement.trim()}>
              与 AI 对话澄清
            </button>
            <button className="primary" onClick={onRun} disabled={running || !requirement.trim() || !selectedPort}>
              {running ? '运行中…' : '🚀 一键全自动开发'}
            </button>
          </div>
        </div>

        {currentState && (
          <div className="state-bar">
            当前状态: <strong>{stateLabel[currentState] || currentState}</strong>
          </div>
        )}
      </div>

      <div className="chat-log">
        <h3>对话与日志</h3>
        <div className="messages">
          {chatHistory.map((m: ConversationMessage, i: number) => (
            <div key={i} className={`msg msg-${m.role}`}>
              <span className="msg-role">{m.role === 'user' ? '我' : 'AI'}:</span>
              <span className="msg-content">{m.content}</span>
            </div>
          ))}
          {logs.map((line: string, i: number) => (
            <div key={`log-${i}`} className="log-line">{line}</div>
          ))}
          {outcome && (
            <div className={`outcome ${outcome.success ? 'success' : 'fail'}`}>
              {outcome.success ? '✅' : '❌'} {outcome.summary}
              {outcome.verdict && (
                <div className="verdict">
                  判定: {outcome.verdict.verdict} | 匹配: {outcome.verdict.matched_cases.join(',')}
                </div>
              )}
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ========== 设备视图 ==========
function DevicesView({ devices, onRefresh }: { devices: DeviceInfo[]; onRefresh: () => void }) {
  return (
    <div className="devices-view">
      <button onClick={onRefresh}>刷新设备列表</button>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse', marginTop: 12 }}>
        <thead>
          <tr><th>端口</th><th>芯片</th><th>MAC</th><th>Flash</th><th>VID</th><th>PID</th><th>产品</th><th>已识别</th></tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.port}>
              <td>{d.port}</td>
              <td>{d.chip ?? '-'}</td>
              <td>{d.mac ?? '-'}</td>
              <td>{d.flash_size ?? '-'}</td>
              <td>{d.vid ? `0x${d.vid.toString(16)}` : '-'}</td>
              <td>{d.pid ? `0x${d.pid.toString(16)}` : '-'}</td>
              <td>{d.product ?? '-'}</td>
              <td>{d.detected ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {devices.length === 0 && <p>未检测到设备，请连接 ESP32 开发板后刷新</p>}
    </div>
  );
}

// ========== 项目视图 ==========
function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    invoke<Project[]>('list_projects').then(setProjects).catch(() => {});
  }, []);

  const del = async (id: string) => {
    await invoke('delete_project', { projectId: id });
    invoke<Project[]>('list_projects').then(setProjects);
  };

  return (
    <div className="projects-view">
      <h3>项目列表（{projects.length}）</h3>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>名称</th><th>芯片</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {projects.map((p: Project) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.chip}</td>
              <td>{p.state}</td>
              <td>{p.created_at}</td>
              <td><button onClick={() => del(p.id)}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {projects.length === 0 && <p>暂无项目</p>}
    </div>
  );
}

// ========== 串口监控视图 ==========
function MonitorView() {
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
        {!active ? <button onClick={start}>打开监控</button> : <button onClick={stop}>关闭监控</button>}
      </div>
      <div className="serial-output">
        {lines.map((l, i) => <div key={i}>{l}</div>)}
        <div ref={endRef} />
      </div>
      <div className="control-row">
        <input value={sendText} onChange={(e) => setSendText(e.target.value)}
          placeholder="输入要发送的数据" onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button onClick={send}>发送</button>
      </div>
    </div>
  );
}

export default App;
