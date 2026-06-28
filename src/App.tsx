// 文件路径：src/App.tsx
// 文件作用：Talk2ESP 主界面——组合各视图，管理全局状态与流水线编排
// 最后更新时间：2026-06-28-1235

import { useEffect, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type {
  DeviceInfo, RequirementSpec, PipelineEvent, PipelineOutcome, ConversationMessage,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationProvider, NotificationCenter, useNotifications } from './components/notifications';
import { Badge, StatusDot } from './components/ui';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from './theme/useTheme';
import { DevelopView } from './views/DevelopView';
import { DevicesView } from './views/DevicesView';
import { ProjectsView } from './views/ProjectsView';
import { MonitorView } from './views/MonitorView';
import { SettingsView } from './views/SettingsView';
import './theme/tokens.css';
import './App.css';

type View = 'develop' | 'devices' | 'projects' | 'monitor' | 'settings';

const APP_VERSION = '0.1.0';

function AppInner() {
  const theme = useTheme();
  const notify = useNotifications();
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
  // #14/#28 阶段重试/耗时/LLM 统计跟踪
  const [retryMap, setRetryMap] = useState<Record<string, { attempt: number; max: number; reason: string }>>({});
  const [stageDurations, setStageDurations] = useState<Record<string, number>>({});
  const [failReasonMap, setFailReasonMap] = useState<Record<string, string>>({});
  const [llmStats, setLlmStats] = useState<{ durationMs: number; tokens?: number } | null>(null);
  // #27 AI 思考子步骤可视化
  const [thinking, setThinking] = useState<string>('');
  // #30 运行历史快照（会话内）
  const [runHistory, setRunHistory] = useState<{
    id: string; requirement: string; chip: string; port: string;
    success: boolean; summary: string; timestamp: string;
  }[]>([]);
  // 阶段开始时间记录（用于计算耗时）
  const stageStartRef = useRef<Record<string, number>>({});
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
    // 重置阶段跟踪状态
    setRetryMap({});
    setStageDurations({});
    setFailReasonMap({});
    setLlmStats(null);
    setThinking('正在分析需求并生成代码…');
    stageStartRef.current = { coding: Date.now() };
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
      const codeGenStart = Date.now();
      ch.onmessage = (event) => {
        if (event.kind === 'StateChanged') {
          // 记录上一阶段耗时
          const prev = currentState;
          if (prev && stageStartRef.current[prev]) {
            const dur = Date.now() - stageStartRef.current[prev];
            setStageDurations((m) => ({ ...m, [prev]: dur }));
          }
          setCurrentState(event.data.state);
          stageStartRef.current[event.data.state] = Date.now();
          // #27 思考子步骤
          const thinkLabel: Record<string, string> = {
            coding: '正在分析需求并生成代码…',
            compiling: '正在编译生成的代码…',
            flashing: '正在烧录到设备…',
            verifying: '正在读取串口输出并验证…',
          };
          setThinking(thinkLabel[event.data.state] ?? '');
          addLog(`▶ 状态: ${event.data.state}`);
        } else if (event.kind === 'Progress') {
          setProgress({ percent: event.data.percent, message: event.data.message });
          addLog(`  ${event.data.message}`);
        } else if (event.kind === 'StageLog') {
          addLog(`[${event.data.stage}] ${event.data.message}`);
        } else if (event.kind === 'CodeGenerated') {
          setGeneratedCode({ main_ino: event.data.main_ino, explanation: event.data.explanation });
          // #28 LLM 代码生成耗时统计
          setLlmStats({ durationMs: Date.now() - codeGenStart });
          setThinking('');
          addLog(`✓ AI 生成代码完成: ${event.data.explanation}`);
        } else if (event.kind === 'ToolOutput') {
          setLogs((l) => [...l, `  ${event.data.line}`]);
        } else if (event.kind === 'Retry') {
          // #14 重试徽章跟踪
          setRetryMap((m) => ({
            ...m,
            [event.data.stage]: { attempt: event.data.attempt, max: event.data.max, reason: event.data.reason },
          }));
          setFailReasonMap((m) => ({ ...m, [event.data.stage]: event.data.reason }));
          addLog(`↻ 重试 ${event.data.stage} (${event.data.attempt}/${event.data.max}): ${event.data.reason}`);
        } else if (event.kind === 'Done') {
          // 记录最后阶段耗时
          const lastState = currentState;
          if (lastState && stageStartRef.current[lastState]) {
            setStageDurations((m) => ({ ...m, [lastState]: Date.now() - stageStartRef.current[lastState] }));
          }
          setProgress({ percent: event.data.success ? 100 : 0, message: event.data.summary });
          setThinking('');
          if (!event.data.success) {
            setFailReasonMap((m) => ({ ...m, [currentState]: event.data.summary }));
          }
          addLog(`■ 完成: ${event.data.summary}`);
        }
      };

      const result = await invoke<PipelineOutcome>('run_full_pipeline', {
        spec, port: selectedPort, projectId: project.id, onEvent: ch,
      });
      setOutcome(result);
      // #30 运行历史快照（会话内）
      setRunHistory((h) => [{
        id: project.id, requirement, chip: selectedChip, port: selectedPort,
        success: result.success, summary: result.summary, timestamp: new Date().toISOString(),
      }, ...h].slice(0, 20));
      if (result.success) {
        addLog('✅ 全自动开发成功！');
        // #26 成功庆祝反馈：显著的成功通知 + 持续提示
        notify.success('🎉 开发成功！', `${selectedChip} 项目已自动完成 生成→编译→烧录→验证 全流程`);
      } else {
        addLog(`❌ 失败: ${result.summary}`);
        notify.error('开发未完成', result.summary);
      }
    } catch (e) {
      addLog(`流水线错误: ${e}`);
      notify.error('流水线异常', String(e));
    }
    setRunning(false);
  };

  // #12 窗口标题动态反馈：根据运行状态/当前视图/设备更新标题
  useEffect(() => {
    const viewLabel: Record<View, string> = {
      develop: '开发', devices: '设备', projects: '项目', monitor: '串口监控', settings: '设置',
    };
    const parts = ['Talk2ESP'];
    if (running) parts.push(`运行中 ${progress.percent}%`);
    else parts.push(viewLabel[view]);
    if (selectedPort) parts.push(selectedPort);
    document.title = parts.join(' · ');
  }, [view, running, progress.percent, selectedPort]);

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="header">
          <div className="header-left">
            <h1>Talk2ESP</h1>
            <span className="subtitle">自然语言驱动的 ESP32 全自动开发</span>
          </div>
          <div className="header-right">
            {/* #6 头部信息增强：设备/芯片/模型/状态灯 */}
            {selectedPort && (
              <span className="header-info" title="当前设备">
                <span aria-hidden>🔌</span> {selectedPort} · {selectedChip}
              </span>
            )}
            {llmConfigured ? (
              <span className="header-info" title="LLM 已配置"><StatusDot state="success" label="LLM" /></span>
            ) : (
              <span className="header-info" title="LLM 未配置"><StatusDot state="error" label="未配置" /></span>
            )}
            <span className="header-version">v{APP_VERSION}</span>
            {running && <Badge tone="info" className="header-running">运行中 {progress.percent}%</Badge>}
            {/* #3 主题切换 + #10 字号调节 */}
            <ThemeToggle
              mode={theme.mode}
              fontScale={theme.fontScale}
              onMode={theme.setMode}
              onFontScale={theme.setFontScale}
              fontScaleLabel={theme.fontScaleLabel}
            />
          </div>
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
                retryMap={retryMap} stageDurations={stageDurations} failReasonMap={failReasonMap}
                llmStats={llmStats} thinking={thinking} runHistory={runHistory}
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
  );
}

/**
 * 应用根组件：在通知系统 Provider 外层包裹，使 AppInner 可使用通知 Hook。
 */
function App() {
  return (
    <NotificationProvider>
      <AppInner />
    </NotificationProvider>
  );
}

export default App;
