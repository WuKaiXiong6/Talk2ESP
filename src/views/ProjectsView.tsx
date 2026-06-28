// 文件路径：src/views/ProjectsView.tsx
// 文件作用：项目管理视图——项目列表 + 详情查看 + 删除
// 最后更新时间：2026-06-28-1230

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Project, ConversationMessage } from '../types';
import { Button, Badge, IconButton } from '../components/ui';
import { EmptyState } from '../components/EmptyState';

export function ProjectsView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [detail, setDetail] = useState<{ code: string; messages: ConversationMessage[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    invoke<Project[]>('list_projects').then(setProjects).catch(() => {}).finally(() => setLoading(false));
  };
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
    } catch (e) {
      setDetail({ code: `加载失败: ${e}`, messages: [] });
    }
  };

  const del = async (id: string) => {
    await invoke('delete_project', { projectId: id });
    if (selected?.id === id) { setSelected(null); setDetail(null); }
    refresh();
  };

  if (selected) {
    return (
      <div className="project-detail ui-card">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>← 返回列表</Button>
        <h3>{selected.name}</h3>
        <div className="detail-meta">
          <span>芯片: <strong>{selected.chip}</strong></span>
          <span>状态: <Badge tone={selected.state === 'archived' ? 'success' : selected.state === 'failed' ? 'danger' : 'info'}>{selected.state}</Badge></span>
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
          {detail && detail.messages.length === 0 && <p className="empty-inline">暂无对话记录</p>}
        </div>

        <div className="detail-actions">
          <Button variant="danger" size="sm" onClick={() => del(selected.id)}>删除项目</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="projects-view ui-card">
      <div className="view-header">
        <h3>项目列表（{projects.length}）</h3>
        {loading && <Badge tone="info">加载中…</Badge>}
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon="📁"
          title="暂无项目"
          description="前往「开发」视图，输入需求即可一键创建项目并自动开发。"
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th><th>芯片</th><th>状态</th><th>端口</th><th>创建时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="clickable" onClick={() => viewDetail(p)}>
                <td>{p.name}</td>
                <td>{p.chip}</td>
                <td>
                  <Badge tone={p.state === 'archived' ? 'success' : p.state === 'failed' ? 'danger' : 'info'}>
                    {p.state}
                  </Badge>
                </td>
                <td>{p.port ?? '-'}</td>
                <td>{p.created_at}</td>
                <td>
                  <IconButton
                    label="删除项目"
                    onClick={(e) => { e.stopPropagation(); del(p.id); }}
                  >
                    🗑
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
