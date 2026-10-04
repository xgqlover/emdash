// [XG-CUSTOM] 项我球（orb.js）/ 旧浮窗（XiangwoFloatingPanel.tsx）共用的**聊天通道工具**：
//   1) 聊天地址解析：由主进程解析、经 preload 暴露（`electronAPI.resolveXiangwoChatUrl()`），
//      渲染进程**不猜主机**；桥接缺失 / 解析抛错 / 字段坏掉 → 一律回落本机 127.0.0.1:8900
//      （保持旧行为，绝不让本机坏掉）。主进程侧规则见 main/host/xiangwo-chat-target.ts。
//   2) 失败自动重试：网络错误 / 5xx 重试最多 3 次（间隔 1.5s / 3s / 5s），把主机上 8900
//      "herdr 重启 ~15 秒空窗"盖掉；4xx（请求本身的问题）与用户主动停止（AbortController）
//      **不重试**。
//   3) [XG-CUSTOM 2026-10-05] **SSE 流式通道**（`streamXiangwoChat`，球用；旧浮窗仍走 2) 的非流式）：
//      治「一轮 69 秒零字节 → 中间层掐断 → 前端只看到 `调用失败: Failed to fetch`」。
//      协议（与服务端 xiangwo-agent/agent.py `_sse_stream` 对齐）：
//        POST /v1/chat/completions  body 带 `"stream": true` → 200 `Content-Type: text/event-stream`
//        `data: {"choices":[{"delta":{"content":"…"}}]}` 增量；`delta.status` 是状态/心跳文案；
//        `delta.content: ""` 是心跳（服务端长工具循环里用它占位）；`data: [DONE]` 结束。
//      耐心（详见下面的常量）：**首字节** 20 秒没到 → 判定连接有问题，重试 2 次（2s / 5s）；
//      一旦收到过字节 → 只按**流内空闲**判（连续 90 秒没字节才超时），空闲期间给「已等待 N 秒」。
//      降级（绝不清空气泡、绝不把能看的内容变成错误）：非 event-stream → 整段渲染；
//      中途断流 → 保留已收部分 + 标注「（连接中断，已显示部分内容）」；
//      **只有"一个字节都没收到"才算失败**。
//
// 放在 TS 里（而不是各写一份 JS）：球与浮窗共用同一份逻辑，且能被 vitest 直接单测。

/** 本机兜底端点（主进程不可用/解析失败时用） */
export const XIANGWO_FALLBACK_CHAT_URL = 'http://127.0.0.1:8900/v1/chat/completions';

/**
 * [XG-CUSTOM] 本机兜底 **agent 基址**（无尾斜杠，与主进程 `XIANGWO_LOCAL_CHAT_BASE` 同值）。
 * 图片网格里的相对地址（`/xg/img?u=…`）靠它拼成绝对 URL；主进程桥接不可用时用它。
 */
export const XIANGWO_FALLBACK_AGENT_BASE = 'http://127.0.0.1:8900';

/** 重试间隔（第 1/2/3 次重试前等待；最多 3 次重试 = 最多 4 次请求） */
export const XIANGWO_RETRY_DELAYS_MS = [1500, 3000, 5000] as const;

/** preload 桥接里我们用到的部分（`window.electronAPI` 的结构子集） */
export type XiangwoChatBridge = {
  resolveXiangwoChatUrl?: () => Promise<unknown>;
};

export type XiangwoChatTargetView = {
  /** 完整聊天端点 */
  url: string;
  /**
   * [XG-CUSTOM 2026-10-03] agent 基址（无尾斜杠，如 `http://10.239.5.174:8900`）。
   * 图片网格的 `url`/`thumb` 可能是 agent 侧相对路径（`/xg/img?u=…`），靠它拼绝对 URL；
   * 主进程的 `XiangwoChatTarget` 本来就带这个字段（env / SSH 转发 / 主机直连 / 本机都算过），
   * 这里只是把它透出来，**不另造一套地址解析**。
   */
  baseUrl: string;
  /** 主进程是否判定可达（false 时 hint 是给用户看的人话提示） */
  reachable: boolean;
  hint: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/**
 * 归一化聊天端点（`http://h:8900` / `http://h:8900/v1` / 完整端点 都能吃）。
 * @param raw 基址或端点
 * @returns `/v1/chat/completions` 端点
 */
export function normalizeChatEndpoint(raw: string): string {
  const base = raw.trim().replace(/\/+$/, '');
  if (base === '') return XIANGWO_FALLBACK_CHAT_URL;
  if (/\/v1\/chat\/completions$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/**
 * [XG-CUSTOM 2026-10-03] 从聊天端点反推 agent 基址
 * （`http://h:8900/v1/chat/completions` → `http://h:8900`）。
 * 主进程没给 `baseUrl`（老版本主进程 / 桥接返回值被裁）时的兜底；反推不出来 → `''`。
 */
export function xiangwoAgentBaseFromChatUrl(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/, '');
  const base = value.replace(/\/v1\/chat\/completions$/i, '').replace(/\/v1$/i, '');
  return isHttpUrl(base) ? base : '';
}

/**
 * [XG-CUSTOM 2026-10-03] **相对资源地址 → 绝对 URL**（图片网格的 `url`/`thumb`/`page` 可能是
 * agent 侧相对路径，如 `/xg/img?u=https%3A%2F%2F…`）。规则：
 *   · 已经是 `http(s)://…` → 原样返回；
 *   · `//host/x`（协议相对）→ 用 base 的协议补全（没有 base 就按 https）；
 *   · 其它相对写法（`/x` 或无前导斜杠）→ 拼到 base（去掉尾斜杠）上；
 *   · **拼不出来（base 不是 http(s) / 为空）→ `''`** —— 调用方据此画「图片不可用」占位，
 *     绝不让整个网格崩。
 * @param baseUrl agent 基址（见 XiangwoChatTargetView.baseUrl）
 * @param raw 原始地址（未知类型一律当空）
 * @returns 绝对 http(s) URL，或 `''`（拼不出来）
 */
export function resolveXiangwoAssetUrl(baseUrl: unknown, raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return '';
  if (isHttpUrl(value)) return value;
  const base = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (value.startsWith('//')) {
    const scheme = /^(https?):\/\//i.exec(base)?.[1]?.toLowerCase() ?? 'https';
    return `${scheme}:${value}`;
  }
  if (!isHttpUrl(base)) return '';
  return value.startsWith('/') ? `${base}${value}` : `${base}/${value}`;
}

/**
 * 问主进程要聊天地址；任何异常/异常返回值都回落本机。
 * @param bridge preload 桥接（`window.electronAPI`）
 */
export async function resolveXiangwoChatUrl(
  bridge: XiangwoChatBridge | undefined
): Promise<XiangwoChatTargetView> {
  try {
    const resolver = bridge?.resolveXiangwoChatUrl;
    if (typeof resolver === 'function') {
      const record = asRecord(await resolver());
      const url = typeof record.url === 'string' ? record.url.trim() : '';
      if (isHttpUrl(url)) {
        // [XG-CUSTOM 2026-10-03] 基址优先用主进程给的那个（它算过 env / SSH 转发 / 主机直连），
        // 没有/坏掉才从这个聊天端点反推 —— 图片相对地址全靠它拼绝对，别在这里猜主机。
        const rawBase = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
        const base = rawBase.replace(/\/+$/, '');
        return {
          url: normalizeChatEndpoint(url),
          baseUrl: isHttpUrl(base) ? base : xiangwoAgentBaseFromChatUrl(url),
          reachable: record.reachable !== false,
          hint: typeof record.hint === 'string' ? record.hint : '',
        };
      }
    }
  } catch {
    /* 桥接不可用 / IPC 抛错 → 兜底 */
  }
  return {
    url: XIANGWO_FALLBACK_CHAT_URL,
    baseUrl: XIANGWO_FALLBACK_AGENT_BASE,
    reachable: true,
    hint: '',
  };
}

/**
 * 4xx：请求本身的问题，重试没意义（用它区别于可重试的失败）。
 */
export class XiangwoNonRetryableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.name = 'XiangwoNonRetryableError';
    this.status = status;
  }
}

export type SendXiangwoChatOptions = {
  /** 完整聊天端点（见 resolveXiangwoChatUrl） */
  url: string;
  /** 请求体（OpenAI 格式：{ messages }） */
  body: unknown;
  /** 用户点「停止」时 abort 它 → 不重试 */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 每次重试前回调（UI 文案用）：attempt 从 1 开始 */
  onRetry?: (attempt: number, delayMs: number) => void;
};

function abortError(): Error {
  const error = new Error('请求已停止');
  error.name = 'AbortError';
  return error;
}

/** 可被 abort 打断的等待（用户在重试等待期间点停止 → 立刻退出，不再重试） */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    const state: { timer?: ReturnType<typeof setTimeout> } = {};
    const onAbort = () => {
      if (state.timer !== undefined) clearTimeout(state.timer);
      reject(abortError());
    };
    state.timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * POST 一次聊天请求，失败自动重试。
 *
 * 重试规则：网络错误（fetch reject）与 5xx → 重试，最多 3 次，间隔 1.5s / 3s / 5s；
 * 4xx → 立刻抛 `XiangwoNonRetryableError`（不重试）；`signal` 已 abort / 等待期间 abort
 * → 立刻抛 AbortError（不重试）。全部失败 → 抛最后一次的错误（调用方显示 `调用失败: …`）。
 * @param options 见 SendXiangwoChatOptions
 * @returns 解析后的响应 JSON
 */
export async function sendXiangwoChat(options: SendXiangwoChatOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  let lastError: Error = new Error('调用失败');
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchImpl(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (response.ok) return (await response.json()) as unknown;
      if (response.status >= 400 && response.status < 500) {
        throw new XiangwoNonRetryableError(response.status);
      }
      lastError = new Error(`HTTP ${String(response.status)}`);
    } catch (cause) {
      if (options.signal?.aborted === true) throw cause;
      if (cause instanceof XiangwoNonRetryableError) throw cause;
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
    const delay = XIANGWO_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) throw lastError;
    options.onRetry?.(attempt + 1, delay);
    await sleep(delay, options.signal);
  }
}

/** 从 OpenAI 兼容响应里取回复文本（取不到给「（无回答）」） */
export function replyTextOf(data: unknown): string {
  const choices = asRecord(data).choices;
  if (!Array.isArray(choices)) return '（无回答）';
  const first: unknown = choices.length > 0 ? choices[0] : undefined;
  const message = asRecord(asRecord(first).message);
  return typeof message.content === 'string' ? message.content : '（无回答）';
}

/** 重试期间的状态文案（球面板 / 浮窗共用） */
export function retryStatusText(attempt: number): string {
  return `后端启动中…（第 ${String(attempt)} 次重试）`;
}

/** 失败文案（保留现有错误展示格式；旧浮窗的非流式路径用它） */
export function failureText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `调用失败: ${message}`;
}

/* ------------------------------------------------------------------------------------------------
 * [XG-CUSTOM 2026-10-05] SSE 流式通道
 * ---------------------------------------------------------------------------------------------- */

/**
 * [XG-CUSTOM] **首字节**超时（ms）：请求发出后这么久没有任何字节回流（连接/响应头/第一个数据块
 * 全算在内）→ 判定这条连接有问题，abort 掉重试。
 * 20 秒的依据：本机 8900 正常时毫秒级回响应头；连不上/隧道断/服务重启时 fetch 会悬着，
 * 旧代码的 10 秒总窗口盖不住也不可能盖住「agent 一轮 69 秒」，所以耐心放在**流内**而不是这里。
 */
export const XIANGWO_FIRST_BYTE_TIMEOUT_MS = 20_000;

/** [XG-CUSTOM] 连接建立阶段的重试间隔（最多 2 次重试 = 最多 3 次请求）；进流之后**绝不**整轮重发 */
export const XIANGWO_STREAM_RETRY_DELAYS_MS = [2000, 5000] as const;

/**
 * [XG-CUSTOM] **流内空闲**上限（ms）：一旦收到过字节，只要 90 秒内还有任意字节/心跳就继续等。
 * 90 > 服务端工具循环里任何一次单步等待（交接台 15 秒超时、LLM 单次调用），
 * 所以正常长卡不会被误杀；真的死了（服务重启）也能在 90 秒内给用户交待。
 */
export const XIANGWO_STREAM_IDLE_TIMEOUT_MS = 90_000;

/** [XG-CUSTOM] 空闲提示刷新间隔（ms）：「agent 还在干活…（已等待 N 秒）」 */
export const XIANGWO_STREAM_IDLE_TICK_MS = 5_000;

/** [XG-CUSTOM] 服务端推来空 content 心跳时状态区显示的话（见 orb.js） */
export const XIANGWO_HEARTBEAT_STATUS = 'agent 正在干活…';

/** [XG-CUSTOM] 服务端把 `stream:true` 当普通请求处理（返回 JSON）时的识别特征（大小写不敏感） */
const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream';

/** 这些 message 说明"根本没连上/连接被掐"，对用户没有意义 → 换成人话 */
const NETWORK_FAILURE_PATTERN = /failed to fetch|networkerror|load failed|fetch failed|terminated/i;

/** 流式解析出来的一个增量帧 */
export type XiangwoSseFrame = {
  /** `delta.content`（'' = 这一帧没有正文） */
  text: string;
  /** `delta.status`（'' = 没有状态文案） */
  status: string;
  /** 服务端明确推了一帧空 content（心跳）→ 状态区显示"还在干活"，但不往气泡里塞东西 */
  heartbeat: boolean;
};

export type XiangwoSseDecoder = {
  /** 吃一段（可能是被任意切断的）文本，吐出这条完整的帧 */
  push: (chunk: string) => XiangwoSseFrame[];
  /** 流结束：把缓冲里没有空行收尾的最后一段也解析掉（服务端忘记发空行也不丢内容） */
  finish: () => XiangwoSseFrame[];
  /** 是否已经收到 `data: [DONE]` */
  done: () => boolean;
};

function framesOfSseEvent(block: string, markDone: () => void): XiangwoSseFrame[] {
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    // 注释行（':' 开头，SSE 的另一种心跳）/ 其它字段（event: / id: / retry:）→ 跳过，不当成内容
    if (!line.startsWith('data:')) continue;
    dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return [];
  const payload = dataLines.join('\n').trim();
  if (payload === '[DONE]') {
    markDone();
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // 非预期格式（半截 JSON / 纯文本行 / 别的协议）→ 不崩、不产帧；字节本身已经算"有回流"
    return [];
  }
  const record = asRecord(parsed);
  if (typeof record.error === 'string' && record.error !== '') {
    return [{ text: '', status: record.error, heartbeat: false }];
  }
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const frames: XiangwoSseFrame[] = [];
  for (const choice of choices) {
    const delta = asRecord(asRecord(choice).delta);
    const text = typeof delta.content === 'string' ? delta.content : '';
    const status = typeof delta.status === 'string' ? delta.status : '';
    frames.push({ text, status, heartbeat: text === '' && status === '' });
  }
  return frames;
}

/**
 * [XG-CUSTOM] 增量 SSE 解码器：**按字节边界无关**地吃 chunk（缓冲不完整的一行/一帧），
 * 空行分隔事件、`data:` 行取载荷、`[DONE]` 结束。坏格式一律忽略（绝不抛错拖垮整轮）。
 */
export function createXiangwoSseDecoder(): XiangwoSseDecoder {
  let buffer = '';
  let ended = false;
  const markDone = () => {
    ended = true;
  };

  const drain = (force: boolean): XiangwoSseFrame[] => {
    const frames: XiangwoSseFrame[] = [];
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(buffer);
      if (separator === null) break;
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      frames.push(...framesOfSseEvent(block, markDone));
    }
    if (force && buffer.trim() !== '') {
      frames.push(...framesOfSseEvent(buffer, markDone));
      buffer = '';
    }
    return frames;
  };

  return {
    push: (chunk: string) => {
      // 跨 chunk 切断的一行/一帧：先攒起来，整帧（空行收尾）才解析
      buffer += chunk;
      return drain(false);
    },
    finish: () => drain(true),
    done: () => ended,
  };
}

/** [XG-CUSTOM] `stream:true` 却拿到普通 JSON/纯文本 → 整段当回答（绝不变成错误） */
export function wholeAnswerText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // 服务端/代理把 SSE 标成了别的 content-type：正文长得像 SSE 就按 SSE 解（不泄漏 `data:` 原文）
  if (/^data:/m.test(trimmed.slice(0, 400))) {
    const decoder = createXiangwoSseDecoder();
    const frames = [...decoder.push(trimmed), ...decoder.finish()];
    const joined = frames.map((frame) => frame.text).join('');
    if (joined !== '') return joined;
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const record = asRecord(parsed);
      const text = replyTextOf(parsed);
      if (text === '（无回答）' && typeof record.error === 'string' && record.error !== '') {
        return record.error;
      }
      return text === '（无回答）' ? trimmed : text;
    } catch {
      /* 不是 JSON → 当纯文本 */
    }
  }
  return raw;
}

/** [XG-CUSTOM] 流中途断/空闲超时后贴在气泡下方的人话标注（保内容，不甩锅给用户） */
export function interruptedNoteText(idleMs: number, reason: 'idle' | 'network'): string {
  const seconds = Math.round(Math.max(0, idleMs) / 1000);
  if (reason === 'idle') {
    return `（连接中断，已显示部分内容）agent 还在干活（已等待 ${String(seconds)} 秒），可以继续等或点停止。`;
  }
  return '（连接中断，已显示部分内容）网络或服务重启了，可以再发一条接着问。';
}

/** [XG-CUSTOM] 流内空闲时的状态区文案（每 5 秒刷一次；秒数向上取整，别显示"已等待 0 秒"） */
export function waitingStatusText(idleMs: number): string {
  const seconds = Math.ceil(Math.max(0, idleMs) / 1000);
  return `agent 还在干活…（已等待 ${String(seconds)} 秒）`;
}

/** 0 字节 → 真的失败了。带上等待时长/重试次数，别再让用户只看到 `Failed to fetch` */
export class XiangwoStreamFailure extends Error {
  readonly waitedMs: number;
  readonly retries: number;
  /** 最后一次尝试是不是"首字节超时"（文案据此说"连不上"而不是复读机） */
  readonly firstByteTimeout: boolean;

  constructor(cause: unknown, waitedMs: number, retries: number, firstByteTimeout = false) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message);
    this.name = 'XiangwoStreamFailure';
    this.waitedMs = waitedMs;
    this.retries = retries;
    this.firstByteTimeout = firstByteTimeout;
  }
}

/**
 * [XG-CUSTOM] 一个字节都没收到时的失败文案（人话）。
 * 例：`调用失败: 连不上后端（8900）（已等待 41 秒；首字节 20 秒等不到，重试 2 次也没连上）`
 */
export function streamFailureText(cause: unknown): string {
  const record = asRecord(cause);
  const waitedMs = typeof record.waitedMs === 'number' ? record.waitedMs : 0;
  const retries =
    typeof record.retries === 'number' ? record.retries : XIANGWO_STREAM_RETRY_DELAYS_MS.length;
  const seconds = Math.round(Math.max(0, waitedMs) / 1000);
  const waited = seconds >= 1 ? `已等待 ${String(seconds)} 秒；` : '';
  if (cause instanceof XiangwoNonRetryableError) {
    return `调用失败: HTTP ${String(cause.status)}（${waited}后端不接受这个请求，重试也没用）`;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const unreachable =
    record.firstByteTimeout === true || NETWORK_FAILURE_PATTERN.test(message);
  const detail = unreachable ? '连不上后端（8900）' : message;
  const retried = retries > 0 ? `重试 ${String(retries)} 次也没连上` : '没能连上';
  return `调用失败: ${detail}（${waited}首字节 ${String(
    Math.round(XIANGWO_FIRST_BYTE_TIMEOUT_MS / 1000)
  )} 秒等不到，${retried}）`;
}

export type StreamXiangwoChatOptions = {
  /** 完整聊天端点（见 resolveXiangwoChatUrl） */
  url: string;
  /** 请求体（OpenAI 格式；`stream:true` 由**调用方**加，见 orb.js） */
  body: unknown;
  /** 用户点「停止」时 abort 它：流内立刻断，已收到的内容仍然返回给调用方 */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** 连接建立阶段每次重试前回调（attempt 从 1 开始，UI 文案用） */
  onRetry?: (attempt: number, delayMs: number) => void;
  /** 增量正文（边收边渲染） */
  onDelta?: (text: string) => void;
  /** 服务端状态文案（`delta.status` / `error`） */
  onStatus?: (text: string) => void;
  /** 服务端空 content 心跳 */
  onHeartbeat?: () => void;
  /** 流内空闲（每 idleTickMs 一次）：idleMs = 已经多久没有字节回流 */
  onIdle?: (idleMs: number) => void;
  firstByteTimeoutMs?: number;
  idleTimeoutMs?: number;
  idleTickMs?: number;
  /** 覆盖连接阶段的重试间隔（默认 XIANGWO_STREAM_RETRY_DELAYS_MS；单测用，别在 UI 里传） */
  retryDelaysMs?: readonly number[];
};

export type XiangwoStreamResult = {
  /** 已收到的完整文本（中途断流时=部分内容，务必保留） */
  text: string;
  /** 是否收到过**任意字节**（false 才是失败；true 时永远不抛错） */
  received: boolean;
  /** 正常结束（`[DONE]` / 连接正常关闭 / 非 SSE 整段） */
  completed: boolean;
  /** 流中途断了（网络/服务重启/空闲超时） */
  interrupted: boolean;
  interruptedReason?: 'idle' | 'network';
  /** 断流前最后一次"有字节"到现在（ms） */
  idleMs: number;
  /** 从发起到现在（ms） */
  waitedMs: number;
  /** 用户点了停止 */
  aborted: boolean;
  /** 服务端对 `stream:true` 返回了非 event-stream（老版本/代理）→ 整段渲染 */
  nonSse: boolean;
};

/** 流内断掉时抛出来的"读错误"（只为区分原因，不面向用户） */
function timeoutError(): Error {
  const error = new Error(`首字节 ${String(Math.round(XIANGWO_FIRST_BYTE_TIMEOUT_MS / 1000))} 秒没到`);
  error.name = 'XiangwoFirstByteTimeout';
  return error;
}

/**
 * [XG-CUSTOM] **流式**发一轮聊天：SSE 增量回调 + 边收边渲染 + 宽松耐心 + 降级。
 *
 * 重试只覆盖"连接建立阶段"（首字节之前）：网络错误 / 5xx / 首字节超时 → 重试 2 次（2s、5s）；
 * 4xx 立刻抛 `XiangwoNonRetryableError`；**收到过字节之后绝不整轮重发**（避免重复开网页/重复点按钮）。
 *
 * 只有"一个字节都没收到"才抛 `XiangwoStreamFailure`（文案见 streamFailureText）；
 * 只要收到过字节 → 一律**返回结果**（含 interrupted/aborted），由调用方保留部分内容。
 * @param options 见 StreamXiangwoChatOptions
 * @returns 本轮结果（text = 已收到的全部增量）
 */
export async function streamXiangwoChat(
  options: StreamXiangwoChatOptions
): Promise<XiangwoStreamResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const firstByteTimeoutMs = options.firstByteTimeoutMs ?? XIANGWO_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? XIANGWO_STREAM_IDLE_TIMEOUT_MS;
  const idleTickMs = options.idleTickMs ?? XIANGWO_STREAM_IDLE_TICK_MS;
  const startedAt = Date.now();
  const retryDelays = options.retryDelaysMs ?? XIANGWO_STREAM_RETRY_DELAYS_MS;

  const attemptOnce = async (): Promise<
    { kind: 'done'; result: XiangwoStreamResult } | { kind: 'retry'; error: Error }
  > => {
    const attemptAbort = new AbortController();
    /** 每次尝试**各算各的**首字节耐心（否则重试会因为上一次已经等满 20 秒而立刻超时） */
    const attemptStartedAt = Date.now();
    const userSignal = options.signal;
    let userAborted = userSignal?.aborted === true;
    const onUserAbort = () => {
      userAborted = true;
      attemptAbort.abort();
    };
    if (userAborted) attemptAbort.abort();
    userSignal?.addEventListener('abort', onUserAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstByteSeen = false;
    let lastByteAt = Date.now();
    let timeoutReason: 'first-byte' | 'idle' | null = null;

    const clearWatchdog = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    /** 一次调度同时管两件事：没收到字节时套首字节超时；收到过就套流内空闲超时 */
    const armWatchdog = () => {
      clearWatchdog();
      if (userAborted) return;
      const idle = firstByteSeen;
      const limit = idle ? idleTimeoutMs : firstByteTimeoutMs;
      const elapsed = idle ? Date.now() - lastByteAt : Date.now() - attemptStartedAt;
      const tick = idle ? Math.min(Math.max(idleTickMs, 100), Math.max(limit - elapsed, 1)) : limit - elapsed;
      timer = setTimeout(() => {
        if (userAborted) return;
        if (!firstByteSeen) {
          timeoutReason = 'first-byte';
          attemptAbort.abort();
          return;
        }
        if (Date.now() - lastByteAt >= idleTimeoutMs) {
          timeoutReason = 'idle';
          attemptAbort.abort();
          return;
        }
        options.onIdle?.(Date.now() - lastByteAt);
        armWatchdog();
      }, Math.max(tick, 1));
    };

    let fullText = '';
    let received = false;
    let nonSse = false;
    const finish = (extra: Partial<XiangwoStreamResult>): XiangwoStreamResult => ({
      text: fullText,
      received,
      completed: false,
      interrupted: false,
      idleMs: Date.now() - lastByteAt,
      waitedMs: Date.now() - startedAt,
      aborted: userAborted,
      nonSse,
      ...extra,
    });

    try {
      armWatchdog();
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(options.body),
          signal: attemptAbort.signal,
        });
      } catch (cause) {
        clearWatchdog();
        if (userAborted) return { kind: 'done', result: finish({}) };
        return { kind: 'retry', error: cause instanceof Error ? cause : new Error(String(cause)) };
      }
      if (!response.ok) {
        clearWatchdog();
        if (response.status >= 400 && response.status < 500) {
          throw new XiangwoNonRetryableError(response.status);
        }
        return { kind: 'retry', error: new Error(`HTTP ${String(response.status)}`) };
      }

      const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();
      nonSse = !contentType.includes(EVENT_STREAM_CONTENT_TYPE);
      const reader = response.body?.getReader?.();

      if (reader === undefined) {
        // 拿不到可读流（老 jsdom / 极端代理）→ 退化成整段
        let raw = '';
        try {
          raw = await response.text();
        } catch (cause) {
          clearWatchdog();
          if (userAborted) return { kind: 'done', result: finish({}) };
          return { kind: 'retry', error: cause instanceof Error ? cause : new Error(String(cause)) };
        }
        clearWatchdog();
        const text = wholeAnswerText(raw);
        received = raw !== '';
        fullText = text;
        if (text !== '') options.onDelta?.(text);
        if (!received) {
          return { kind: 'retry', error: new Error('响应没有正文') };
        }
        return { kind: 'done', result: finish({ completed: true, nonSse: true }) };
      }

      const decoder = new TextDecoder();
      const sse = createXiangwoSseDecoder();
      const rawChunks: string[] = [];
      let completed = false;
      let interrupted = false;

      const applyFrames = (frames: XiangwoSseFrame[]) => {
        for (const frame of frames) {
          if (frame.text !== '') {
            fullText += frame.text;
            options.onDelta?.(frame.text);
          }
          if (frame.status !== '') options.onStatus?.(frame.status);
          else if (frame.heartbeat) options.onHeartbeat?.();
        }
      };

      const noteBytes = () => {
        received = true;
        lastByteAt = Date.now();
        if (!firstByteSeen) {
          firstByteSeen = true;
          armWatchdog(); // 换成流内空闲看门狗
        }
      };

      try {
        for (;;) {
          const step = await reader.read();
          if (step.done === true) {
            completed = true;
            break;
          }
          const value = step.value;
          const size =
            value === undefined || value === null
              ? 0
              : typeof value.byteLength === 'number'
                ? value.byteLength
                : typeof value.length === 'number'
                  ? value.length
                  : 0;
          if (size > 0) noteBytes();
          const chunk = decoder.decode(value, { stream: true });
          if (chunk === '') continue;
          if (nonSse) rawChunks.push(chunk);
          else applyFrames(sse.push(chunk));
          if (!nonSse && sse.done()) {
            completed = true;
            break;
          }
        }
      } catch {
        // 读中断：用户停止（保留已收内容、不报错）或网络/空闲超时（保留 + 标注）
        if (!(userAborted || options.signal?.aborted === true)) interrupted = true;
      } finally {
        clearWatchdog();
        userSignal?.removeEventListener('abort', onUserAbort);
        if (!completed) {
          try {
            await reader.cancel();
          } catch {
            /* 已经在断掉的路由上报错，忽略 */
          }
        }
      }

      // 收尾：把没走完的一行/最后一帧吐出来（服务端忘记补空行也不丢内容）
      const tail = decoder.decode();
      if (nonSse) {
        // 非 SSE：整段当回答（服务端把 stream 当普通请求处理 / 代理改了 content-type）
        if (tail !== '') rawChunks.push(tail);
        const text = wholeAnswerText(rawChunks.join(''));
        fullText = text;
        if (text !== '') options.onDelta?.(text);
      } else {
        applyFrames([...(tail === '' ? [] : sse.push(tail)), ...sse.finish()]);
      }

      const result = finish({
        completed: completed || (!nonSse && sse.done()),
        interrupted,
        interruptedReason: interrupted ? (timeoutReason === 'idle' ? 'idle' : 'network') : undefined,
      });
      if (!received) {
        // 一个字节都没有 → 才算失败（0 字节的 200 / 立刻 EOF 都算连接没建立成功）
        if (userAborted) return { kind: 'done', result };
        if (timeoutReason === 'first-byte') return { kind: 'retry', error: timeoutError() };
        return { kind: 'retry', error: new Error('连接建立了但没有回任何数据') };
      }
      return { kind: 'done', result };
    } finally {
      clearWatchdog();
      userSignal?.removeEventListener('abort', onUserAbort);
    }
  };

  let lastError: Error = new Error('调用失败');
  let firstByteTimeoutSeen = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const outcome = await attemptOnce();
      if (outcome.kind === 'done') return outcome.result;
      lastError = outcome.error;
      if (outcome.error.name === 'XiangwoFirstByteTimeout') firstByteTimeoutSeen = true;
      if (options.signal?.aborted === true) {
        return {
          text: '',
          received: false,
          completed: false,
          interrupted: false,
          idleMs: 0,
          waitedMs: Date.now() - startedAt,
          aborted: true,
          nonSse: false,
        };
      }
    } catch (cause) {
      if (options.signal?.aborted === true) throw cause;
      if (cause instanceof XiangwoNonRetryableError) throw cause;
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
    const delay = retryDelays[attempt];
    if (delay === undefined) {
      throw new XiangwoStreamFailure(
        lastError,
        Date.now() - startedAt,
        retryDelays.length,
        firstByteTimeoutSeen
      );
    }
    options.onRetry?.(attempt + 1, delay);
    await sleep(delay, options.signal);
  }
}
