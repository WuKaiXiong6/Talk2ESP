// 文件路径：src/views/ProjectsView.tsx
// 文件作用：项目管理视图——搜索/排序/重命名/导入导出/删除二次确认+回收站(#58)/状态刷新/卡片化
// 最后更新时间：2026-06-29-0130

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Project, ConversationMessage } from '../types';
import { Button, Badge, Card, IconButton } from '../components/ui';
import { EmptyState } from '../components/EmptyState';
import { SkeletonTable } from '../components/Skeleton';
import { useNotifications } from '../components/notifications';
import './ProjectsView.css';

/// 排序方式
type SortKey = 'updated' | 'created' | 'name' | 'state';

interface ProjectsViewProps {
  onGoDevelop: () => void;
}

export function ProjectsView({ onGoDevelop }: ProjectsViewProps) {
  const notify = useNotifications();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [detail, setDetail] = useState<{ code: string; messages: ConversationMessage[] } | null>(null);
  const [loading, setLoading] = useState(false);
  // #53 搜索
  const [search, setSearch] = useState('');
  // #55 排序
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  // #54 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // #59 删除二次确认
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // #56 导入
  const [importing, setImporting] = useState(false);
  // #60 分页
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  // #58 回收站
  const [trash, setTrash] = useState<string[]>([]);
  const [showTrash, setShowTrash] = useState(false);

  const refresh = () => {
    setLoading(true);
    invoke<Project[]>('list_projects').then(setProjects).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  // #53/#55 搜索 + 排序
  const filteredSorted = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) || p.chip.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name, 'zh');
        case 'created': return b.created_at.localeCompare(a.created_at);
        case 'state': return a.state.localeCompare(b.state);
        default: return b.updated_at.localeCompare(a.updated_at);
      }
    });
    return sorted;
  }, [projects, search, sortKey]);

  // #60 分页：搜索/排序变化时重置到第一页
  useEffect(() => { setPage(1); }, [search, sortKey]);
  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const paged = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // #57 复制项目
  const duplicateProject = async (p: Project) => {
    try {
      await invoke('duplicate_project', { projectId: p.id, newName: `${p.name}_副本` });
      notify.success('已复制项目', `${p.name}_副本`);
      refresh();
    } catch (e) { notify.error('复制失败', String(e)); }
  };

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

  // #54 重命名
  const startRename = (p: Project) => { setRenamingId(p.id); setRenameValue(p.name); };
  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    try {
      await invoke('rename_project', { projectId: renamingId, newName: renameValue.trim() });
      notify.success('已重命名', renameValue.trim());
      setRenamingId(null);
      refresh();
    } catch (e) { notify.error('重命名失败', String(e)); }
  };

  // #59 删除二次确认（#58 改为移入回收站）
  const confirmDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await invoke('delete_project', { projectId: confirmDeleteId });
      notify.success('项目已移入回收站', '可在回收站恢复');
      if (selected?.id === confirmDeleteId) { setSelected(null); setDetail(null); }
      setConfirmDeleteId(null);
      refresh();
    } catch (e) { notify.error('删除失败', String(e)); }
  };

  // #58 回收站操作
  const refreshTrash = () => {
    invoke<string[]>('list_trash').then(setTrash).catch(() => setTrash([]));
  };
  const restoreFromTrash = async (id: string) => {
    try {
      await invoke('restore_project', { projectId: id });
      notify.success('项目已恢复', id);
      refreshTrash();
      refresh();
    } catch (e) { notify.error('恢复失败', String(e)); }
  };
  const purgeFromTrash = async (id: string) => {
    if (!confirm(`彻底删除项目 ${id}？此操作不可恢复。`)) return;
    try {
      await invoke('purge_trash_project', { projectId: id });
      notify.success('已彻底删除', id);
      refreshTrash();
    } catch (e) { notify.error('删除失败', String(e)); }
  };
  const emptyAllTrash = async () => {
    if (!confirm('清空整个回收站？所有已删除项目将不可恢复。')) return;
    try {
      const n = await invoke<number>('empty_trash');
      notify.success('回收站已清空', `已彻底删除 ${n} 个项目`);
      refreshTrash();
    } catch (e) { notify.error('清空失败', String(e)); }
  };

  // #56 导出
  const exportProject = async (p: Project) => {
    try {
      const bytes = await invoke<number[]>('export_project', { projectId: p.id });
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${p.name}_${p.id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      notify.success('已导出', `${p.name}.zip`);
    } catch (e) { notify.error('导出失败', String(e)); }
  };

  // #56 导入
  const importProject = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buf));
      const p = await invoke<Project>('import_project', { zipBytes: bytes });
      notify.success('已导入项目', p.name);
      refresh();
    } catch (e) { notify.error('导入失败', String(e)); }
    setImporting(false);
  };

  if (selected) {
    return (
      <div className="project-detail ui-card">
        <div className="detail-toolbar">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>← 返回列表</Button>
          <Button variant="secondary" size="sm" onClick={() => exportProject(selected)}>📦 导出</Button>
        </div>
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
          <Button variant="danger" size="sm" onClick={() => setConfirmDeleteId(selected.id)}>删除项目</Button>
        </div>
        {confirmDeleteId === selected.id && (
          <div className="confirm-dialog" role="alertdialog">
            <span>确认删除项目「{selected.name}」？项目将移入回收站，可在回收站恢复。</span>
            <div className="confirm-actions">
              <Button variant="danger" size="sm" onClick={confirmDelete}>确认删除</Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>取消</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="projects-view">
      <div className="view-header">
        <h3>项目列表（{filteredSorted.length}/{projects.length}）</h3>
        <div className="projects-actions">
          {/* #56 导入 */}
          <label className="import-label">
            <input
              type="file"
              accept=".zip"
              className="hidden-file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importProject(f); e.target.value = ''; }}
            />
            <Button variant="secondary" size="sm" loading={importing} disabled={importing}>📥 导入</Button>
          </label>
        </div>
      </div>

      {/* #53 搜索 + #55 排序 */}
      <div className="projects-toolbar">
        <input
          className="projects-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 搜索项目名/芯片/ID…"
        />
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="projects-sort">
          <option value="updated">按更新时间</option>
          <option value="created">按创建时间</option>
          <option value="name">按名称</option>
          <option value="state">按状态</option>
        </select>
        {/* #58 回收站入口 */}
        <Button variant="ghost" size="sm" onClick={() => { setShowTrash((v) => !v); if (!showTrash) refreshTrash(); }}>
          🗑 回收站 {trash.length > 0 && `(${trash.length})`}
        </Button>
      </div>

      {/* #58 回收站面板 */}
      {showTrash && (
        <Card className="trash-panel">
          <div className="trash-header">
            <h4>回收站（{trash.length}）</h4>
            {trash.length > 0 && (
              <Button variant="danger" size="sm" onClick={emptyAllTrash}>清空回收站</Button>
            )}
          </div>
          {trash.length === 0 ? (
            <p className="empty-inline">回收站为空</p>
          ) : (
            <ul className="trash-list">
              {trash.map((id) => (
                <li key={id} className="trash-item">
                  <span className="trash-id">{id}</span>
                  <Button variant="secondary" size="sm" onClick={() => restoreFromTrash(id)}>↩ 恢复</Button>
                  <Button variant="ghost" size="sm" onClick={() => purgeFromTrash(id)}>✕ 彻底删除</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {loading ? (
        <SkeletonTable rows={3} cols={5} />
      ) : filteredSorted.length === 0 ? (
        <EmptyState
          icon="📁"
          title={search ? '无匹配项目' : '暂无项目'}
          description={search ? '尝试更换搜索关键词' : '前往「开发」视图，输入需求即可一键创建项目并自动开发。'}
          actions={!search ? [{ label: '去开发', onClick: onGoDevelop }] : undefined}
        />
      ) : (
        <>
        <div className="projects-grid">
          {paged.map((p) => (
            <Card key={p.id} interactive className="project-card" onClick={() => viewDetail(p)}>
              <div className="project-card-header">
                {renamingId === p.id ? (
                  <div className="rename-box" onClick={(e) => e.stopPropagation()}>
                    <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenamingId(null); }}
                      autoFocus
                    />
                    <IconButton label="确认" onClick={confirmRename}>✓</IconButton>
                    <IconButton label="取消" onClick={() => setRenamingId(null)}>✕</IconButton>
                  </div>
                ) : (
                  <span className="project-name" title={p.name}>{p.name}</span>
                )}
                <Badge tone={p.state === 'archived' ? 'success' : p.state === 'failed' ? 'danger' : 'info'}>{p.state}</Badge>
              </div>
              <div className="project-card-body">
                <div className="project-field"><span>芯片</span><strong>{p.chip}</strong></div>
                <div className="project-field"><span>端口</span><strong>{p.port ?? '-'}</strong></div>
                <div className="project-field"><span>更新</span><strong>{p.updated_at}</strong></div>
              </div>
              <div className="project-card-actions" onClick={(e) => e.stopPropagation()}>
                <IconButton label="重命名" onClick={() => startRename(p)}>✏</IconButton>
                {/* #57 复制项目 */}
                <IconButton label="复制" onClick={() => duplicateProject(p)}>📋</IconButton>
                <IconButton label="导出" onClick={() => exportProject(p)}>📦</IconButton>
                <IconButton label="删除" onClick={() => setConfirmDeleteId(p.id)}>🗑</IconButton>
              </div>
              {confirmDeleteId === p.id && (
                <div className="confirm-dialog" role="alertdialog" onClick={(e) => e.stopPropagation()}>
                  <span>确认删除？移入回收站可恢复</span>
                  <div className="confirm-actions">
                    <Button variant="danger" size="sm" onClick={confirmDelete}>删除</Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>取消</Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
        {/* #60 分页 */}
        {totalPages > 1 && (
          <div className="pagination">
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</Button>
            <span className="pagination-info">第 {page} / {totalPages} 页（共 {filteredSorted.length} 项）</span>
            <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</Button>
          </div>
        )}
        </>
      )}
    </div>
  );
}
