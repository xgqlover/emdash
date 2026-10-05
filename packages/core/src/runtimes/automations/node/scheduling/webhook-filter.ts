// [XG-CUSTOM 2026-10-05] **事件载荷过滤器 webhook-filter** —— 事件触发（webhook）的 `filter` 求值。
//
// 对照开源：OpenHands 的 `AutomationTrigger.filter` 用 **JMESPath** 对 webhook 原始 payload 求值。
// 我们**不引依赖、不用 eval**（这是一个"外部输入 × 本地代理"的边界，随便求值等于开门），
// 自写一个**很小的、可穷举的**表达式语言：
//
//   expr    := or
//   or      := and ( '||' and )*
//   and     := cmp ( '&&' cmp )*
//   cmp     := path op value | path 'exists' | path 'notExists'
//   op      := '==' | '!=' | 'contains' | 'startsWith' | 'endsWith'
//   path    := seg ( '.' seg | '[' N ']' )*        seg := [A-Za-z_][A-Za-z0-9_-]*
//   value   := '"…"'（单双引号皆可） | true | false | 数字
//
// 例：`action == "opened" && repository.name == "emdash"`、`commits[0].message contains "fix"`
//
// **三条硬约定**：
//   ① 空 filter → 一律匹配（等于"没过滤"）；
//   ② **解析失败 → 不匹配**（fail-closed：宁可漏跑一次，也不让畸形表达式放行）；
//   ③ 路径不存在 → 不匹配（`notExists` 反之）。**不抛异常**给调用方。
//
// 回归测试见 ./webhook-filter.test.ts。

type Op = '==' | '!=' | 'contains' | 'startsWith' | 'endsWith' | 'exists' | 'notExists';

type Comparison = {
  path: string[];
  op: Op;
  /** `exists`/`notExists` 没有右值 */
  value?: string | number | boolean;
};

// ⚠️ 三个成员分开写（别把 'and'|'or' 塞进同一个成员）：那样判别收窄会失效，
//    `evaluate()` 里的 `expr.cmp` 会报 TS2339（实测踩到）。
type Expr =
  | { kind: 'and'; left: Expr; right: Expr }
  | { kind: 'or'; left: Expr; right: Expr }
  | { kind: 'cmp'; cmp: Comparison };

const OPS: Op[] = ['==', '!=', 'contains', 'startsWith', 'endsWith', 'exists', 'notExists'];

/** 解析（创建 automation 时也能用它做前置校验） */
export function parseWebhookFilter(filter: string): { ok: true } | { ok: false; reason: string } {
  const text = (filter ?? '').trim();
  if (text === '') return { ok: true };
  const parsed = parseOr(tokenize(text));
  if (parsed === null) return { ok: false, reason: 'unparsable' };
  return { ok: true };
}

/** 求值：空/未定义 → true；解析失败 → false；路径缺失 → false（除 notExists） */
export function matchWebhookFilter(filter: string | undefined, payload: unknown): boolean {
  const text = (filter ?? '').trim();
  if (text === '') return true;
  const parsed = parseOr(tokenize(text));
  if (parsed === null) return false;
  return evaluate(parsed, payload);
}

// ── 词法 ───────────────────────────────────────────────────────────────
type Token =
  | { kind: 'path'; value: string }
  | { kind: 'op'; value: Op }
  | { kind: 'literal'; value: string | number | boolean }
  | { kind: 'and' }
  | { kind: 'or' };

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  while (i < text.length) {
    const ch = text[i]!;
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (text.startsWith('&&', i)) {
      tokens.push({ kind: 'and' });
      i += 2;
      continue;
    }
    if (text.startsWith('||', i)) {
      tokens.push({ kind: 'or' });
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) return null;
      tokens.push({ kind: 'literal', value: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const op = OPS.find((candidate) => text.startsWith(candidate, i));
    if (op !== undefined && op !== 'exists' && op !== 'notExists') {
      tokens.push({ kind: 'op', value: op });
      i += op.length;
      continue;
    }
    if (text.startsWith('exists', i) || text.startsWith('notExists', i)) {
      const value: Op = text.startsWith('notExists', i) ? 'notExists' : 'exists';
      tokens.push({ kind: 'op', value });
      i += value.length;
      continue;
    }
    // ⚠️ 布尔字面量必须**排在路径分支之前**：`true`/`false` 也满足 `/^[A-Za-z_]/`，
    //    先走路径分支的话 `draft == true` 会解析成「路径 == 路径」→ 判为不可解析 → fail-closed 全 false。
    if (text.startsWith('true', i) && !/[A-Za-z0-9_]/.test(text[i + 4] ?? '')) {
      tokens.push({ kind: 'literal', value: true });
      i += 4;
      continue;
    }
    if (text.startsWith('false', i) && !/[A-Za-z0-9_]/.test(text[i + 5] ?? '')) {
      tokens.push({ kind: 'literal', value: false });
      i += 5;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      // 路径：seg(.seg|[N])*  —— 只认字母数字下划线连字符 + 点 + 方括号数字
      while (j < text.length && /[A-Za-z0-9_.\-[\]]/.test(text[j]!)) j += 1;
      const raw = text.slice(i, j);
      if (!isValidPath(raw)) return null;
      tokens.push({ kind: 'path', value: raw });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || ch === '-') {
      let j = i + (ch === '-' ? 1 : 0);
      while (j < text.length && /[0-9.]/.test(text[j]!)) j += 1;
      const num = Number(text.slice(i, j));
      if (!Number.isFinite(num)) return null;
      tokens.push({ kind: 'literal', value: num });
      i = j;
      continue;
    }
    return null;
  }
  return tokens;
}

function isValidPath(raw: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\d+\])*$/.test(raw);
}

// ── 语法 ───────────────────────────────────────────────────────────────
function parseOr(tokens: Token[] | null): Expr | null {
  if (tokens === null) return null;
  let index = 0;
  const peek = () => tokens[index];
  const parseAnd = (): Expr | null => {
    let left = parseCmp();
    if (left === null) return null;
    while (peek()?.kind === 'and') {
      index += 1;
      const right = parseCmp();
      if (right === null) return null;
      left = { kind: 'and', left, right };
    }
    return left;
  };
  const parseCmp = (): Expr | null => {
    const path = peek();
    if (path?.kind !== 'path') return null;
    index += 1;
    const op = peek();
    if (op?.kind !== 'op') return null;
    index += 1;
    if (op.value === 'exists' || op.value === 'notExists') {
      return { kind: 'cmp', cmp: { path: splitPath(path.value), op: op.value } };
    }
    const rhs = peek();
    if (rhs === undefined || rhs.kind !== 'literal') return null;
    index += 1;
    return { kind: 'cmp', cmp: { path: splitPath(path.value), op: op.value, value: rhs.value } };
  };

  let left = parseAnd();
  if (left === null) return null;
  while (peek()?.kind === 'or') {
    index += 1;
    const right = parseAnd();
    if (right === null) return null;
    left = { kind: 'or', left, right };
  }
  if (index !== tokens.length) return null; // 有剩余 token = 表达式不完整/多余
  return left;
}

function splitPath(raw: string): string[] {
  return raw
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((part) => part !== '');
}

// ── 求值 ───────────────────────────────────────────────────────────────
function lookup(payload: unknown, path: string[]): { found: boolean; value: unknown } {
  let current: unknown = payload;
  for (const segment of path) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (/^\d+$/.test(segment)) {
      if (!Array.isArray(current)) return { found: false, value: undefined };
      const index = Number(segment);
      if (index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return { found: false, value: undefined };
    const holder = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(holder, segment)) {
      return { found: false, value: undefined };
    }
    current = holder[segment];
  }
  return { found: true, value: current };
}

function evaluate(expr: Expr, payload: unknown): boolean {
  if (expr.kind === 'and') return evaluate(expr.left, payload) && evaluate(expr.right, payload);
  if (expr.kind === 'or') return evaluate(expr.left, payload) || evaluate(expr.right, payload);
  const { path, op, value } = expr.cmp;
  const hit = lookup(payload, path);
  if (op === 'exists') return hit.found;
  if (op === 'notExists') return !hit.found;
  if (!hit.found) return false;
  const actual = hit.value;
  switch (op) {
    case '==':
      return actual === value || (typeof actual === 'number' && actual === Number(value));
    case '!=':
      return !(actual === value || (typeof actual === 'number' && actual === Number(value)));
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(value));
      if (Array.isArray(actual)) return actual.includes(value);
      return false;
    case 'startsWith':
      return typeof actual === 'string' && actual.startsWith(String(value));
    case 'endsWith':
      return typeof actual === 'string' && actual.endsWith(String(value));
    default:
      return false;
  }
}
