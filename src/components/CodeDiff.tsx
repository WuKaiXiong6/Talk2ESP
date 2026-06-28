// 文件路径：src/components/CodeDiff.tsx
// 文件作用：代码 diff 查看器——对比修复前后代码，行级增删着色（自研 LCS 算法，避免引入依赖）
// 最后更新时间：2026-06-28-1315

import { useMemo } from 'react';
import './CodeDiff.css';

interface CodeDiffProps {
  oldCode: string;
  newCode: string;
  /** 标题 */
  title?: string;
}

interface DiffLine {
  type: 'equal' | 'add' | 'remove';
  oldNum?: number;
  newNum?: number;
  text: string;
}

/// 行级 LCS diff：返回差异行列表
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;
  // LCS DP 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // 回溯生成 diff
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  let oldNum = 1, newNum = 1;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'equal', oldNum: oldNum++, newNum: newNum++, text: oldLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', oldNum: oldNum++, text: oldLines[i] });
      i++;
    } else {
      result.push({ type: 'add', newNum: newNum++, text: newLines[j] });
      j++;
    }
  }
  while (i < m) result.push({ type: 'remove', oldNum: oldNum++, text: oldLines[i++] });
  while (j < n) result.push({ type: 'add', newNum: newNum++, text: newLines[j++] });
  return result;
}

/**
 * 代码 diff 查看器：行级增删着色，左侧旧行号右侧新行号。
 * 自研 LCS 算法，无额外依赖。
 */
export function CodeDiff({ oldCode, newCode, title }: CodeDiffProps) {
  const diffLines = useMemo(
    () => computeDiff(oldCode.split('\n'), newCode.split('\n')),
    [oldCode, newCode],
  );

  const added = diffLines.filter((d) => d.type === 'add').length;
  const removed = diffLines.filter((d) => d.type === 'remove').length;

  return (
    <div className="code-diff">
      {title && (
        <div className="code-diff-header">
          <span>{title}</span>
          <span className="code-diff-stats">
            <span className="diff-add">+{added}</span>
            <span className="diff-remove">-{removed}</span>
          </span>
        </div>
      )}
      <div className="code-diff-body">
        {diffLines.map((line, idx) => (
          <div key={idx} className={`diff-line diff-${line.type}`}>
            <span className="diff-line-old">{line.oldNum ?? ''}</span>
            <span className="diff-line-new">{line.newNum ?? ''}</span>
            <span className="diff-line-marker">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="diff-line-text">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
