// 文件路径：src/components/CodeBlock.tsx
// 文件作用：代码展示组件——highlight.js 语法高亮 + 行号 + 复制按钮，用于 AI 生成代码/测试桩代码展示
// 最后更新时间：2026-06-28-1240

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import plaintext from 'highlight.js/lib/languages/plaintext';
import 'highlight.js/styles/atom-one-dark.css';
import './CodeBlock.css';

// 按需注册语言，避免引入全量包
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('arduino', cpp); // Arduino 使用 cpp 语法
hljs.registerLanguage('plaintext', plaintext);

interface CodeBlockProps {
  /** 代码内容 */
  code: string;
  /** 语言（cpp/arduino/plaintext）*/
  language?: string;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 是否显示复制按钮 */
  copyable?: boolean;
  /** 最大高度（CSS 值），默认不限 */
  maxHeight?: string;
  /** 标题（如文件名）*/
  title?: string;
}

/**
 * 代码展示块：语法高亮 + 行号 + 复制。
 * 使用 highlight.js 按需注册 cpp/arduino/plaintext，避免全量包体积。
 */
export function CodeBlock({
  code,
  language = 'cpp',
  showLineNumbers = true,
  copyable = true,
  maxHeight,
  title,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  // 高亮结果（依赖 code 与 language，缓存）
  const highlighted = useMemo(() => {
    const lang = hljs.getLanguage(language) ? language : 'plaintext';
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      // 高亮失败时转义后原样返回
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, language]);

  // 复制到剪贴板
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API 在非安全上下文可能不可用，静默失败
    }
  };

  // 行号列表
  const lineCount = code.split('\n').length;
  useEffect(() => {
    // 高亮后无需额外操作，highlight.js 已注入 .hljs 类
  }, [highlighted]);

  return (
    <div className="code-block-wrapper">
      {title && <div className="code-block-title">{title}</div>}
      <div className="code-block-container" style={{ maxHeight }}>
        {copyable && (
          <button
            className="code-block-copy"
            onClick={handleCopy}
            title={copied ? '已复制' : '复制代码'}
            aria-label="复制代码"
          >
            {copied ? '✓' : '📋'}
          </button>
        )}
        <pre className="code-block hljs">
          {showLineNumbers && (
            <code className="code-block-gutter" aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
            </code>
          )}
          <code
            ref={codeRef}
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  );
}
