// 文件路径：src/views/HelpView.tsx
// 文件作用：帮助视图——首次启动向导 + 内置帮助/FAQ + 示例库浏览套用 + 反馈入口
// 最后更新时间：2026-06-28-1330

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button, Card, Badge } from '../components/ui';
import { CodeBlock } from '../components/CodeBlock';
import { useNotifications } from '../components/notifications';
import './HelpView.css';

/// 示例信息
interface ExampleInfo {
  name: string;
  code: string;
  summary: string;
}

interface HelpViewProps {
  /** 首次启动向导模式 */
  wizard?: boolean;
  /** 套用示例回调（将示例代码填入开发视图）*/
  onUseExample?: (code: string, name: string) => void;
  /** 关闭向导 */
  onCloseWizard?: () => void;
}

/// FAQ 条目
const FAQ: { q: string; a: string }[] = [
  { q: '如何开始第一次开发？', a: '1) 在「设置」配置 LLM（API Key/Base URL/模型）；2) 在「设备」连接 ESP32；3) 在「开发」输入需求点「一键全自动开发」即可。' },
  { q: '支持哪些芯片？', a: '当前支持 ESP32-S3 与 ESP32-C3。可在设置页查看引脚黑名单可视化图。' },
  { q: '设备识别不到怎么办？', a: '常见原因：①USB 数据线不支持数据传输；②CH343/CP210x 驱动未安装（设备页有驱动检测）；③端口被其他串口工具占用。' },
  { q: 'AI 生成代码失败？', a: '检查 LLM 配置（设置页可「测试连接」）；推理模型 max_tokens 建议 ≥ 8192；网络需能访问 LLM 服务。' },
  { q: '如何手动编辑代码后重跑？', a: '代码生成后点「编辑代码」修改，再点「用编辑后的代码重跑」可跳过 AI 生成直接编译烧录。' },
  { q: '快捷键有哪些？', a: 'Ctrl+1~5 切换视图（开发/设备/项目/监控/设置）；运行中按 Esc 终止流水线。' },
];

export function HelpView({ wizard, onUseExample, onCloseWizard }: HelpViewProps) {
  const notify = useNotifications();
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [selectedExample, setSelectedExample] = useState<ExampleInfo | null>(null);
  const [tab, setTab] = useState<'guide' | 'examples' | 'faq'>(wizard ? 'guide' : 'examples');

  useEffect(() => {
    invoke<ExampleInfo[]>('list_examples').then(setExamples).catch(() => {});
  }, []);

  return (
    <div className="help-view">
      {wizard && (
        <div className="wizard-banner">
          <span>👋 欢迎使用 Talk2ESP！首次使用建议完成以下准备：</span>
          <Button variant="ghost" size="sm" onClick={onCloseWizard}>跳过</Button>
        </div>
      )}

      <div className="help-tabs">
        <button className={`help-tab ${tab === 'guide' ? 'active' : ''}`} onClick={() => setTab('guide')}>📖 快速上手</button>
        <button className={`help-tab ${tab === 'examples' ? 'active' : ''}`} onClick={() => setTab('examples')}>🧪 示例库</button>
        <button className={`help-tab ${tab === 'faq' ? 'active' : ''}`} onClick={() => setTab('faq')}>❓ 常见问题</button>
      </div>

      {tab === 'guide' && (
        <Card className="help-section">
          <h3>快速上手三步</h3>
          <ol className="guide-steps">
            <li>
              <strong>配置 LLM</strong>
              <p>前往「设置」页，选择供应商预设（火山/智谱/DeepSeek 等），填入 API Key，点「测试连接」确认可用。</p>
            </li>
            <li>
              <strong>连接设备</strong>
              <p>前往「设备」页，连接 ESP32 开发板后刷新，点「测试连接」确认；选为开发设备。</p>
            </li>
            <li>
              <strong>一键开发</strong>
              <p>前往「开发」页，用自然语言描述需求（或点快捷示例），点「🚀 一键全自动开发」，等待 AI 生成→编译→烧录→验证。</p>
            </li>
          </ol>
          {/* #99 反馈入口 */}
          <div className="feedback-entry">
            <span>遇到问题或有建议？</span>
            <Button variant="secondary" size="sm" onClick={() => notify.info('反馈入口', '请通过 GitHub Issues 或项目仓库提交反馈')}>💬 反馈</Button>
          </div>
        </Card>
      )}

      {tab === 'examples' && (
        <Card className="help-section">
          <h3>内置示例库（{examples.length}）</h3>
          <p className="help-desc">点击查看示例代码，可套用到开发视图作为起点。</p>
          <div className="examples-grid">
            {examples.map((ex) => (
              <div
                key={ex.name}
                className={`example-card ${selectedExample?.name === ex.name ? 'selected' : ''}`}
                onClick={() => setSelectedExample(ex)}
              >
                <div className="example-name">{ex.name}</div>
                <div className="example-summary">{ex.summary.slice(0, 80)}</div>
              </div>
            ))}
          </div>
          {selectedExample && (
            <div className="example-detail">
              <div className="example-detail-header">
                <h4>{selectedExample.name}</h4>
                <div className="example-actions">
                  {onUseExample && (
                    <Button variant="primary" size="sm" onClick={() => { onUseExample(selectedExample.code, selectedExample.name); notify.success('已套用示例', selectedExample.name); }}>
                      套用到开发
                    </Button>
                  )}
                  <Badge tone="info">Arduino</Badge>
                </div>
              </div>
              <CodeBlock code={selectedExample.code} language="arduino" maxHeight="360px" title={`${selectedExample.name}.ino`} />
            </div>
          )}
        </Card>
      )}

      {tab === 'faq' && (
        <Card className="help-section">
          <h3>常见问题</h3>
          <div className="faq-list">
            {FAQ.map((item, i) => (
              <details key={i} className="faq-item">
                <summary className="faq-q">{item.q}</summary>
                <p className="faq-a">{item.a}</p>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
