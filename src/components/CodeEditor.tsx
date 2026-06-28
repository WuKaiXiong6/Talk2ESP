// 文件路径：src/components/CodeEditor.tsx
// 文件作用：可编辑代码编辑器——textarea + 行号 + 高亮覆盖层，支持编辑后重跑
// 最后更新时间：2026-06-28-1315

import { useMemo, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import './CodeEditor.css';

interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  language?: string;
  /** 只读模式 */
  readOnly?: boolean;
  /** 最小高度 */
  minHeight?: string;
  placeholder?: string;
}

/**
 * 轻量代码编辑器：textarea 透明叠在 highlight.js 高亮层上，同步滚动与行号。
 * 不引入 CodeMirror 全量依赖，保持打包体积可控；满足"可编辑 + 高亮 + 行号"核心需求。
 */
export function CodeEditor({
  value,
  onChange,
  language = 'arduino',
  readOnly = false,
  minHeight = '280px',
  placeholder,
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // 高亮后的 HTML
  const highlighted = useMemo(() => {
    const lang = hljs.getLanguage(language) ? language : 'plaintext';
    try {
      return hljs.highlight(value || '', { language: lang }).value;
    } catch {
      return (value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [value, language]);

  const lineCount = (value || '').split('\n').length;

  // 同步滚动：textarea 与高亮层、行号 gutter 保持一致
  const handleScroll = () => {
    if (textareaRef.current && preRef.current && gutterRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Tab 键插入两个空格而非切换焦点
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="code-editor" style={{ minHeight }}>
      <div className="code-editor-gutter" ref={gutterRef} aria-hidden>
        {Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (
          <div key={i} className="code-editor-line-num">{i + 1}</div>
        ))}
      </div>
      <pre className="code-editor-highlight hljs" ref={preRef} aria-hidden>
        <code
          className={`language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted + '\n' }}
        />
      </pre>
      <textarea
        ref={textareaRef}
        className="code-editor-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        aria-label="代码编辑器"
      />
    </div>
  );
}
