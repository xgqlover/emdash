// [XG-CUSTOM] 项我球（orb.js）/ 旧浮窗（XiangwoFloatingPanel.tsx）共用的**聊天通道工具**：
//   1) 聊天地址解析：由主进程解析、经 preload 暴露（`electronAPI.resolveXiangwoChatUrl()`），
//      渲染进程**不猜主机**；桥接缺失 / 解析抛错 / 字段坏掉 → 一律回落本机 127.0.0.1:8900
//      （保持旧行为，绝不让本机坏掉）。主进程侧规则见 main/host/xiangwo-chat-target.ts。
//   2) 失败自动重试：网络错误 / 5xx 重试最多 3 次（间隔 1.5s / 3s / 5s），把主机上 8900
//      "herdr 重启 ~15 秒空窗"盖掉；4xx（请求本身的问题）与用户主动停止（AbortController）
//      **不重试**。
//
// 放在 TS 里（而不是各写一份 JS）：球与浮窗共用同一份逻辑，且能被 vitest 直接单测。

/** 本机兜底端点（主进程不可用/解析失败时用） */
export const XIANGWO_FALLBACK_CHAT_URL = 'http://127.0.0.1:8900/v1/chat/completions';

/** 重试间隔（第 1/2/3 次重试前等待；最多 3 次重试 = 最多 4 次请求） */
export const XIANGWO_RETRY_DELAYS_MS = [1500, 3000, 5000] as const;

/** preload 桥接里我们用到的部分（`window.electronAPI` 的结构子集） */
export type XiangwoChatBridge = {
  resolveXiangwoChatUrl?: () => Promise<unknown>;
};

export type XiangwoChatTargetView = {
  /** 完整聊天端点 */
  url: string;
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
        return {
          url: normalizeChatEndpoint(url),
          reachable: record.reachable !== false,
          hint: typeof record.hint === 'string' ? record.hint : '',
        };
      }
    }
  } catch {
    /* 桥接不可用 / IPC 抛错 → 兜底 */
  }
  return { url: XIANGWO_FALLBACK_CHAT_URL, reachable: true, hint: '' };
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

/** 失败文案（保留现有错误展示格式） */
export function failureText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `调用失败: ${message}`;
}
