// 文件路径：src/components/ChatMessage.tsx
// 文件作用：对话消息渲染——Markdown（react-markdown）+ 代码块语法高亮 + 复制按钮
// 最后更新时间：2026-06-28-1310

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationMessage } from '../types';
import { CodeBlock } from './CodeBlock';
import './ChatMessage.css';

interface ChatMessageProps {
  message: ConversationMessage;
  /** #77 重新生成（仅 assistant 消息显示）*/
  onRegenerate?: () => void;
}

/// 代码块渲染组件（react-markdown 的 code 自定义渲染）
function CodeRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
  const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? 'plaintext';
  const code = String(children ?? '').replace(/\n$/, '');
  // 内联代码（无语言且短）直接渲染
  if (!className && !code.includes('\n')) {
    return <code className="inline-code">{code}</code>;
  }
  return <CodeBlock code={code} language={lang === 'cpp' || lang === 'c' ? 'arduino' : lang} maxHeight="240px" />;
}

/**
 * 单条对话消息：用户/AI 区分，AI 消息以 Markdown 渲染（含代码块高亮）。
 */
export function ChatMessage({ message, onRegenerate }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 静默 */ }
  };

  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className={`chat-message chat-message-${message.role}`}>
      <div className="chat-message-avatar" aria-hidden>{isUser ? '🧑' : '🤖'}</div>
      <div className="chat-message-body">
        <div className="chat-message-meta">
          <span className="chat-message-role">{isUser ? '我' : 'AI'}</span>
          <span className="chat-message-time">{time}</span>
          <div className="chat-message-actions">
            <button className="chat-message-btn" onClick={handleCopy} title="复制">
              {copied ? '✓' : '📋'}
            </button>
            {/* #77 重新生成（仅 AI 消息）*/}
            {!isUser && onRegenerate && (
              <button className="chat-message-btn" onClick={onRegenerate} title="重新生成">🔄</button>
            )}
          </div>
        </div>
        <div className="chat-message-content">
          {isUser ? (
            <div className="chat-message-text">{message.content}</div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ code: CodeRenderer as never }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
