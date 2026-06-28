// 文件路径：src/utils/codeCheck.ts
// 文件作用：代码格式化与引脚黑名单检查工具——#84 基本格式检查 + #82 引脚引用检测
// 最后更新时间：2026-06-28-1620

/// #84 格式化检查结果
export interface FormatIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

/// #82 引脚引用（用于悬浮提示黑名单状态）
export interface PinRef {
  pin: number;
  line: number;
  context: string;
}

/// #84 基本代码格式检查：括号配对、分号缺失、大括号配对、常见语法
/// 注意：这是轻量启发式检查，非完整 C++ 语法分析；用于给用户即时提示
export function checkCodeFormat(code: string): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const lines = code.split('\n');
  let parenDepth = 0;
  let braceDepth = 0;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // 跳过空行与注释行
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;

    // 括号配对统计（忽略字符串内的）
    const codeOnly = stripStringsAndComments(line);
    for (const ch of codeOnly) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    // 检查语句末尾缺分号（排除控制语句、大括号、预处理、函数定义）
    const controlKw = /^(if|else|for|while|switch|case|default|do|try|catch)\b/;
    const isControl = controlKw.test(trimmed);
    const endsWithBraceOrParen = /[{}();,]\s*(\/\/.*)?$/.test(trimmed);
    const isPreprocessor = trimmed.startsWith('#');
    const isFuncDef = /[\w:]+\s+\w+\s*\([^)]*\)\s*(const)?\s*$/.test(trimmed) && !trimmed.includes(';');
    const looksLikeStatement = !isControl && !endsWithBraceOrParen && !isPreprocessor && !isFuncDef
      && !trimmed.endsWith('{') && !trimmed.endsWith('}') && !trimmed.endsWith(':');

    if (looksLikeStatement && !trimmed.endsWith(';') && !trimmed.endsWith(',')) {
      issues.push({
        line: idx + 1, column: line.length + 1, severity: 'warning',
        message: '语句可能缺少分号结尾',
      });
    }
  });

  // 整体配平检查
  if (parenDepth !== 0) {
    const sign = parenDepth > 0 ? '多 ' + parenDepth + ' 个 (' : '多 ' + (-parenDepth) + ' 个 )';
    issues.push({
      line: lines.length, column: 1, severity: 'error',
      message: '圆括号未配平（' + sign + '）',
    });
  }
  if (braceDepth !== 0) {
    const sign = braceDepth > 0 ? '多 ' + braceDepth + ' 个 {' : '多 ' + (-braceDepth) + ' 个 }';
    issues.push({
      line: lines.length, column: 1, severity: 'error',
      message: '大括号未配平（' + sign + '）',
    });
  }

  return issues;
}

/// 移除字符串与注释内容，避免误判其中的括号
function stripStringsAndComments(line: string): string {
  let result = '';
  let inString = false;
  let inChar = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    // 行注释
    if (ch === '/' && line[i + 1] === '/') break;
    if (inString) {
      if (ch === '\\' ) { result += '  '; i += 2; continue; }
      if (ch === '"') inString = false;
      result += ' ';
    } else if (inChar) {
      if (ch === '\\' ) { result += '  '; i += 2; continue; }
      if (ch === "'") inChar = false;
      result += ' ';
    } else {
      if (ch === '"') { inString = true; result += ' '; }
      else if (ch === "'") { inChar = true; result += ' '; }
      else result += ch;
    }
    i++;
  }
  return result;
}

/// #82 提取代码中的引脚引用（pinMode/digitalWrite/等函数的首个整型参数，及 GPIOxx 宏）
export function extractPinRefs(code: string): PinRef[] {
  const refs: PinRef[] = [];
  const pinFuncs = ['pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'attachInterrupt', 'ledcAttachPin', 'ledcWrite', 'touchRead'];
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    const codeOnly = stripStringsAndComments(line);
    // 匹配函数调用 func(N, ...)
    for (const fn of pinFuncs) {
      const re = new RegExp(`${fn}\\s*\\(\\s*(\\d+)`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(codeOnly)) !== null) {
        const pin = parseInt(m[1], 10);
        if (!isNaN(pin) && !refs.some((r) => r.pin === pin && r.line === idx + 1)) {
          refs.push({ pin, line: idx + 1, context: trimmed.slice(0, 60) });
        }
      }
    }
    // 匹配 GPIOxx 宏形式
    const gpioRe = /GPIO(\d+)/g;
    let gm: RegExpExecArray | null;
    while ((gm = gpioRe.exec(codeOnly)) !== null) {
      const pin = parseInt(gm[1], 10);
      if (!isNaN(pin) && !refs.some((r) => r.pin === pin && r.line === idx + 1)) {
        refs.push({ pin, line: idx + 1, context: trimmed.slice(0, 60) });
      }
    }
  });
  return refs;
}

/// #82 判断引脚是否在黑名单中
export function classifyPin(
  pin: number,
  blacklist: { error: number[]; errorOctal: number[]; warn: number[] },
): 'error' | 'warn' | 'safe' {
  if (blacklist.error.includes(pin)) return 'error';
  if (blacklist.errorOctal.includes(pin)) return 'error';
  if (blacklist.warn.includes(pin)) return 'warn';
  return 'safe';
}
