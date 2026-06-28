// 文件路径：src/views/HelpView.tsx
// 文件作用：帮助视图——首次启动向导 + 内置帮助/FAQ + 示例库浏览套用 + 反馈表单(#99) + i18n
// 最后更新时间：2026-06-29-0230

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button, Card, Badge } from '../components/ui';
import { CodeBlock } from '../components/CodeBlock';
import { useNotifications } from '../components/notifications';
import { useI18n } from '../i18n';
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

/// FAQ 条目（使用 i18n key 引用，渲染时通过 t() 取本地化文本）
const FAQ_KEYS: { qKey: string; aKey: string }[] = [
  { qKey: 'faq.q1', aKey: 'faq.a1' },
  { qKey: 'faq.q2', aKey: 'faq.a2' },
  { qKey: 'faq.q3', aKey: 'faq.a3' },
  { qKey: 'faq.q4', aKey: 'faq.a4' },
  { qKey: 'faq.q5', aKey: 'faq.a5' },
  { qKey: 'faq.q6', aKey: 'faq.a6' },
];

export function HelpView({ wizard, onUseExample, onCloseWizard }: HelpViewProps) {
  const notify = useNotifications();
  const { t } = useI18n();
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [selectedExample, setSelectedExample] = useState<ExampleInfo | null>(null);
  const [tab, setTab] = useState<'guide' | 'examples' | 'faq' | 'feedback'>(wizard ? 'guide' : 'examples');
  // #99 反馈表单
  const [fbType, setFbType] = useState('bug');
  const [fbText, setFbText] = useState('');

  useEffect(() => {
    invoke<ExampleInfo[]>('list_examples').then(setExamples).catch(() => {});
  }, []);

  return (
    <div className="help-view">
      {wizard && (
        <div className="wizard-banner">
          <span>{t('help.welcome')}</span>
          <Button variant="ghost" size="sm" onClick={onCloseWizard}>{t('help.skip')}</Button>
        </div>
      )}

      <div className="help-tabs">
        <button className={`help-tab ${tab === 'guide' ? 'active' : ''}`} onClick={() => setTab('guide')}>{t('help.tabGuide')}</button>
        <button className={`help-tab ${tab === 'examples' ? 'active' : ''}`} onClick={() => setTab('examples')}>{t('help.tabExamples')}</button>
        <button className={`help-tab ${tab === 'faq' ? 'active' : ''}`} onClick={() => setTab('faq')}>{t('help.tabFaq')}</button>
        <button className={`help-tab ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}>{t('help.tabFeedback')}</button>
      </div>

      {tab === 'guide' && (
        <Card className="help-section">
          <h3>{t('help.guideTitle')}</h3>
          <ol className="guide-steps">
            <li>
              <strong>{t('help.step1')}</strong>
              <p>{t('help.step1Desc')}</p>
            </li>
            <li>
              <strong>{t('help.step2')}</strong>
              <p>{t('help.step2Desc')}</p>
            </li>
            <li>
              <strong>{t('help.step3')}</strong>
              <p>{t('help.step3Desc')}</p>
            </li>
          </ol>
          {/* #99 反馈入口 */}
          <div className="feedback-entry">
            <span>{t('help.feedbackEntry')}</span>
            <Button variant="secondary" size="sm" onClick={() => setTab('feedback')}>{t('help.feedbackBtn')}</Button>
          </div>
        </Card>
      )}

      {tab === 'examples' && (
        <Card className="help-section">
          <h3>{t('help.examplesTitle')}（{examples.length}）</h3>
          <p className="help-desc">{t('help.examplesDesc')}</p>
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
                    <Button variant="primary" size="sm" onClick={() => { onUseExample(selectedExample.code, selectedExample.name); notify.success(t('help.exampleApplied'), selectedExample.name); }}>
                      {t('help.applyExample')}
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
          <h3>{t('help.faqTitle')}</h3>
          <div className="faq-list">
            {FAQ_KEYS.map((item, i) => (
              <details key={i} className="faq-item">
                <summary className="faq-q">{t(item.qKey)}</summary>
                <p className="faq-a">{t(item.aKey)}</p>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* #99 反馈表单 */}
      {tab === 'feedback' && (
        <Card className="help-section">
          <h3>{t('help.feedbackTitle')}</h3>
          <p className="help-desc">{t('help.feedbackDesc')}</p>
          <div className="feedback-form">
            <div className="feedback-row">
              <label>{t('help.fbType')}</label>
              <select value={fbType} onChange={(e) => setFbType(e.target.value)}>
                <option value="bug">{t('help.fbBug')}</option>
                <option value="feature">{t('help.fbFeature')}</option>
                <option value="question">{t('help.fbQuestion')}</option>
                <option value="other">{t('help.fbOther')}</option>
              </select>
            </div>
            <div className="feedback-row">
              <label>{t('help.fbDesc')}</label>
              <textarea
                value={fbText}
                onChange={(e) => setFbText(e.target.value)}
                placeholder={t('help.fbPlaceholder')}
                rows={6}
              />
            </div>
            <div className="feedback-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={!fbText.trim()}
                onClick={() => {
                  const typeLabelMap: Record<string, string> = {
                    bug: t('help.fbLabelBug'),
                    feature: t('help.fbLabelFeature'),
                    question: t('help.fbLabelQuestion'),
                    other: t('help.fbLabelOther'),
                  };
                  const typeLabel = typeLabelMap[fbType] || t('help.fbDefaultLabel');
                  const title = encodeURIComponent(`[${typeLabel}] ${fbText.slice(0, 40)}`);
                  const body = encodeURIComponent(`## ${t('help.fbType')}\n${typeLabel}\n\n## ${t('help.fbDesc')}\n${fbText}\n\n## Env\n- App: Talk2ESP\n- Time: ${new Date().toLocaleString()}\n`);
                  const url = `https://github.com/Wukaixiong/Talk2ESP/issues/new?title=${title}&body=${body}`;
                  window.open(url, '_blank');
                  notify.success(t('help.fbIssueOpened'), t('help.fbIssueOpenedDesc'));
                }}
              >
                {t('help.fbGenIssue')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!fbText.trim()}
                onClick={() => {
                  const text = `【${fbType}】\n${fbText}`;
                  navigator.clipboard?.writeText(text).then(
                    () => notify.success(t('help.fbCopied'), t('help.fbCopiedDesc')),
                    () => notify.error(t('help.fbCopyFailed'), t('help.fbCopyFailedDesc')),
                  );
                }}
              >
                {t('help.fbCopy')}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
