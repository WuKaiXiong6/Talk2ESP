// 文件路径：src/App.tsx
// 文件作用：Talk2ESP 主界面——组合各视图，管理全局状态与流水线编排
// 最后更新时间：2026-06-28-1230

import { useEffect, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type {
  DeviceInfo, RequirementSpec, PipelineEvent, PipelineOutcome, ConversationMessage,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationProvider, NotificationCenter } from './components/notifications';
import { Badge } from './components/ui';
import { DevelopView } from './views/DevelopView';
import { DevicesView } from './views/DevicesView';
import { ProjectsView } from './views/ProjectsView';
import { MonitorView } from './views/MonitorView';
import { SettingsView } from './views/SettingsView';
import './theme/tokens.css';
import './App.css';

type View = 'develop' | 'devices' | 'projects' | 'monitor' | 'settings';

const APP_VERSION = '0.1.0';

function App() {
  const [view, setView] = useState<View>('develop');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
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
    setDevicesLoading(true);
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
    } finally {
      setDevicesLoading(false);
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
    <NotificationProvider>
      <ErrorBoundary>
        <div className="app">
          <header className="header">
            <h1>Talk2ESP</h1>
            <span className="subtitle">自然语言驱动的 ESP32 全自动开发</span>
            <span className="header-version">v{APP_VERSION}</span>
            {running && <Badge tone="info" className="header-running">运行中</Badge>}
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
            {view === 'devices' && (
              <DevicesView
                devices={devices} loading={devicesLoading}
                onRefresh={refreshDevices} onGoDevelop={() => setView('develop')}
              />
            )}
            {view === 'projects' && <ProjectsView />}
            {view === 'monitor' && <MonitorView />}
            {view === 'settings' && (
              <SettingsView onSaved={() => invoke<boolean>('is_llm_configured').then(setLlmConfigured)} />
            )}
          </main>
        </div>
        <NotificationCenter />
      </ErrorBoundary>
    </NotificationProvider>
  );
}

export default App;
