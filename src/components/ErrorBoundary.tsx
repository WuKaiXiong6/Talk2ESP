// 文件路径：src/components/ErrorBoundary.tsx
// 文件作用：全局错误边界——捕获子组件渲染异常，展示友好兜底页而非白屏崩溃
// 最后更新时间：2026-06-28-1230

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React 错误边界：捕获子树渲染期抛出的异常，展示兜底页并提供「重试」。
 * 注意：仅捕获渲染、生命周期与构造函数中的异常；事件回调内的异常不在此捕获（需 try/catch）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 输出到控制台便于排查，不吞掉异常信息
    console.error('[Talk2ESP] 组件异常被错误边界捕获:', error, info.componentStack);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const err = this.state.error;
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-icon" aria-hidden>⚠️</div>
          <h2 className="error-boundary-title">界面出现异常</h2>
          <p className="error-boundary-desc">
            应用遇到一个未预期的错误。可以尝试重新加载该界面；若反复出现，请导出日志反馈。
          </p>
          {err && (
            <details className="error-boundary-details">
              <summary>查看错误详情</summary>
              <pre className="error-boundory-stack">{err.message}</pre>
            </details>
          )}
          <div className="error-boundary-actions">
            <button className="error-boundary-retry" onClick={this.handleRetry}>重试</button>
            <button className="error-boundary-reload" onClick={() => window.location.reload()}>
              重新加载应用
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
