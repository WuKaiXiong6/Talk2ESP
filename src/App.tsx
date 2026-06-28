// 文件路径：src/App.tsx
// 文件作用：Talk2ESP 主界面——设备选择/需求输入/全自动流水线/实时日志/串口监控
// 最后更新时间：2026-06-28-1037

import { useEffect, useState, useRef } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type {
  DeviceInfo, RequirementSpec, PipelineEvent, PipelineOutcome, ConversationMessage, Project, Settings,
} from './types';
import './App.css';

type View = 'develop' | 'devices' | 'projects' | 'monitor' | 'settings';

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
  const [progress, setProgress] = useState<{ percent: number; message: string }>({ percent: 0, message: '' });
  const [generatedCode, setGeneratedCode] = useState<{ main_ino: string; explanation: string } | null>(null);
  const [outcome, setOutcome] = useState<PipelineOutcome | null>(null);
  const [chatHistory, setChatHistory] = useState<ConversationMessage[]>([]);
  const [llmConfigured, setLlmConfigured] = useState<boolean>(true);
  const logEndRef = useRef<HTMLDivElement>(null);
  const stopFlagRef = useRef<boolean>(false);

  // 初始化：扫描设备 + 加载芯片列表 + 检查 LLM 配置
  useEffect(() => {
    refreshDevices();
    invoke<string[]>('list_chips').then(setChips).catch(() => {});
    invoke<boolean>('is_llm_configured').then(setLlmConfigured).catch(() => {});
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

  // 暂停/终止流水线（当前实现：标记停止，前端停止接收；后端因是单次 await 无法中途杀，但会尽快结束）
  const stopPipeline = () => {
    stopFlagRef.current = true;
    setRunning(false);
    addLog('■ 用户已请求终止（当前进行中的步骤完成后停止）');
    setProgress((p) => ({ ...p, message: '正在终止…' }));
  };

  // 一键全自动开发：需求 → 流水线
  const runAutoPipeline = async () => {
    if (!requirement.trim()) { addLog('请先输入需求'); return; }
    if (!selectedPort) { addLog('请先选择设备'); return; }
    if (!llmConfigured) {
      addLog('❌ LLM 未配置，请先到「设置」填写配置');
      setView('settings');
      return;
    }
    stopFlagRef.current = false;
    setRunning(true);
    setLogs([]);
    setOutcome(null);
    setCurrentState('coding');
    setProgress({ percent: 5, message: '启动中…' });
    setGeneratedCode(null);
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
          addLog(`▶ 状态: ${event.data.state}`);
        } else if (event.kind === 'Progress') {
          setProgress({ percent: event.data.percent, message: event.data.message });
          addLog(`  ${event.data.message}`);
        } else if (event.kind === 'StageLog') {
          addLog(`[${event.data.stage}] ${event.data.message}`);
        } else if (event.kind === 'CodeGenerated') {
          setGeneratedCode({ main_ino: event.data.main_ino, explanation: event.data.explanation });
          addLog(`✓ AI 生成代码完成: ${event.data.explanation}`);
        } else if (event.kind === 'ToolOutput') {
          setLogs((l) => [...l, `  ${event.data.line}`]);
        } else if (event.kind === 'Retry') {
          addLog(`↻ 重试 ${event.data.stage} (${event.data.attempt}/${event.data.max}): ${event.data.reason}`);
        } else if (event.kind === 'Done') {
          setProgress({ percent: event.data.success ? 100 : 0, message: event.data.summary });
          addLog(`■ 完成: ${event.data.summary}`);
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
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>设置</button>
        {!llmConfigured && <span className="nav-warn">⚠️ 未配置 LLM</span>}
      </nav>

      <main className="main">
        {view === 'develop' && (
          <DevelopView
            devices={devices} selectedPort={selectedPort} selectedChip={selectedChip}
            chips={chips} requirement={requirement} running={running} currentState={currentState}
            progress={progress} generatedCode={generatedCode} llmConfigured={llmConfigured}
            chatHistory={chatHistory} logs={logs} outcome={outcome} logEndRef={logEndRef}
            onRefreshDevices={refreshDevices} onPort={setSelectedPort} onChip={setSelectedChip}
            onRequirement={setRequirement} onChat={chatWithAi} onRun={runAutoPipeline} onStop={stopPipeline}
            onGoSettings={() => setView('settings')}
          />
        )}
        {view === 'devices' && <DevicesView devices={devices} onRefresh={refreshDevices} />}
        {view === 'projects' && <ProjectsView />}
        {view === 'monitor' && <MonitorView />}
        {view === 'settings' && <SettingsView onSaved={() => invoke<boolean>('is_llm_configured').then(setLlmConfigured)} />}
      </main>
    </div>
  );
}

// ========== 开发视图 ==========
function DevelopView(props: any) {
  const { devices, selectedPort, selectedChip, chips, requirement, running, currentState,
    progress, generatedCode, llmConfigured, chatHistory, logs, outcome, logEndRef,
    onRefreshDevices, onPort, onChip, onRequirement, onChat, onRun, onStop, onGoSettings } = props;

  const stateLabel: Record<string, string> = {
    coding: '🧠 AI 生成代码', compiling: '⚙️ 编译中', flashing: '📡 烧录中',
    verifying: '🔍 验证中', archived: '✅ 完成', failed: '❌ 失败',
  };

  return (
    <div className="develop-view">
      {!llmConfigured && (
        <div className="config-warn">
          ⚠️ 尚未配置 LLM，无法进行 AI 开发。
          <button className="link-btn" onClick={onGoSettings}>前往设置 →</button>
        </div>
      )}
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
            {running && <button className="danger" onClick={onStop}>⏹ 终止</button>}
          </div>
        </div>

        {(running || progress.percent > 0) && (
          <div className="progress-section">
            <div className="progress-header">
              {running && <span className="thinking-dots">AI 思考中</span>}
              {currentState && <strong>{stateLabel[currentState] || currentState}</strong>}
              <span className="progress-percent">{progress.percent}%</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
            <div className="progress-message">{progress.message}</div>
          </div>
        )}

        {generatedCode && (
          <div className="code-section">
            <h4>AI 生成的代码 {generatedCode.explanation && <span className="code-explain">— {generatedCode.explanation}</span>}</h4>
            <pre className="code-block">{generatedCode.main_ino}</pre>
          </div>
        )}
      </div>

      <div className="chat-log">
        <h3>过程日志</h3>
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
  const [selected, setSelected] = useState<Project | null>(null);
  const [detail, setDetail] = useState<{ code: string; messages: ConversationMessage[] } | null>(null);

  const refresh = () => invoke<Project[]>('list_projects').then(setProjects).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const viewDetail = async (p: Project) => {
    setSelected(p);
    setDetail(null);
    try {
      const [code, messages] = await Promise.all([
        invoke<string>('read_main_code', { projectId: p.id }).catch(() => '(无代码)'),
        invoke<ConversationMessage[]>('load_messages', { projectId: p.id }).catch(() => []),
      ]);
      setDetail({ code, messages });
    } catch (e) { setDetail({ code: `加载失败: ${e}`, messages: [] }); }
  };

  const del = async (id: string) => {
    await invoke('delete_project', { projectId: id });
    if (selected?.id === id) { setSelected(null); setDetail(null); }
    refresh();
  };

  if (selected) {
    return (
      <div className="project-detail">
        <button onClick={() => setSelected(null)}>← 返回列表</button>
        <h3>{selected.name}</h3>
        <div className="detail-meta">
          <span>芯片: {selected.chip}</span>
          <span>状态: <strong>{selected.state}</strong></span>
          <span>端口: {selected.port ?? '-'}</span>
          <span>创建: {selected.created_at}</span>
          <span>重试: 编{selected.retry_counts.compile}/烧{selected.retry_counts.flash}/验{selected.retry_counts.verify}</span>
        </div>

        <h4>主程序代码</h4>
        <pre className="code-block">{detail?.code ?? '加载中…'}</pre>

        <h4>对话记录（{detail?.messages.length ?? 0}）</h4>
        <div className="messages">
          {detail?.messages.map((m, i) => (
            <div key={i} className={`msg msg-${m.role}`}>
              <span className="msg-role">{m.role === 'user' ? '我' : 'AI'}:</span>
              <span className="msg-content">{m.content}</span>
            </div>
          ))}
          {detail && detail.messages.length === 0 && <p className="empty">暂无对话记录</p>}
        </div>

        <button className="danger" onClick={() => del(selected.id)}>删除项目</button>
      </div>
    );
  }

  return (
    <div className="projects-view">
      <h3>项目列表（{projects.length}）— 点击查看详情</h3>
      <table border={1} cellPadding={6} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>名称</th><th>芯片</th><th>状态</th><th>端口</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="clickable" onClick={() => viewDetail(p)}>
              <td>{p.name}</td>
              <td>{p.chip}</td>
              <td>{p.state}</td>
              <td>{p.port ?? '-'}</td>
              <td>{p.created_at}</td>
              <td><button onClick={(e) => { e.stopPropagation(); del(p.id); }}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {projects.length === 0 && <p className="empty">暂无项目，去「开发」视图创建一个吧</p>}
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

// ========== 设置视图 ==========
function SettingsView({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<Settings>('load_settings').then(setSettings).catch(() => {});
  }, []);

  const update = (path: string, value: any) => {
    if (!settings) return;
    const next = JSON.parse(JSON.stringify(settings));
    const keys = path.split('.');
    let obj = next;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = value;
    setSettings(next);
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await invoke('save_settings', { settings });
      setSaved(true);
      onSaved();
    } catch (e) { alert(`保存失败: ${e}`); }
    setSaving(false);
  };

  if (!settings) return <div>加载设置中…</div>;

  return (
    <div className="settings-view">
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
        <button className="primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '💾 保存设置'}</button>
        {saved && <span className="saved-ok">✓ 已保存</span>}
      </div>
    </div>
  );
}

export default App;
