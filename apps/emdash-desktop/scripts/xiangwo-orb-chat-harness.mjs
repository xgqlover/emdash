#!/usr/bin/env node
// [XG-CUSTOM] 项我球聊天通道 harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`（产出 out/renderer/orb/orb.html + out/renderer/assets/orb-*.js）
// 用法：`node scripts/xiangwo-orb-chat-harness.mjs`（在 apps/emdash-desktop 下）
//
// 假桥 harness（沿用上一轮排查「展开态点球没反应」的做法）：用 jsdom 载入**产物 html**，
// 把 preload 桥（window.electronAPI）和 fetch 换成假的，再动态 import **产物 bundle**，
// 驱动真实 UI（填 #prompt → submit），只断言外部可见的事实（请求次数/地址/DOM 文案）。
//
// 断言：
//   ① 聊天地址来自 preload 解析值
//   ② 解析失败 → 回落 127.0.0.1
//   ③ 连接阶段失败会重试（2 次间隔 2s/5s）→ 最终成功 + 重试文案出现过
//   ④ 4xx 不重试（只发 1 次）+ 人话失败文案
//   ⑤ 用户中止不重试（只发 1 次，显示「（已停止）」）
//   ⑥ [流式] 分 5 个 chunk 推 delta.content → 气泡**逐步增长** + [DONE] 后结束
//   ⑦ [流式] 首字节 20 秒不来 → 触发重试；收到过字节后长空闲（>10s）→ 不判失败 + 「已等待 N 秒」
//   ⑧ [流式] 非 SSE（普通 JSON）→ 整段渲染，不报错
//   ⑨ [流式] 流中途断 → 保留部分内容 + 「（连接中断，已显示部分内容）」
//   ⑩ [流式] 点停止 → 请求被 abort、保留已收内容
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(HERE, '..', 'out', 'renderer');
const ORB_HTML = resolve(RENDERER_DIR, 'orb', 'orb.html');
const LOCAL_URL = 'http://127.0.0.1:8900/v1/chat/completions';

const failures = [];
const passes = [];

function check(label, condition, detail = '') {
  if (condition) {
    passes.push(label);
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`);
    console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`);
  }
}

/** 从产物 html 里拿出 bundle 路径（hash 会变，不能写死） */
function readOrbBundle() {
  const html = readFileSync(ORB_HTML, 'utf8');
  const match = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html);
  if (match === null) throw new Error(`产物 html 里找不到 module script: ${ORB_HTML}`);
  return { html, bundle: resolve(dirname(ORB_HTML), match[1]) };
}

const SCRIPT_TAG = /<script[^>]*type="module"[^>]*><\/script>/;

const GLOBAL_KEYS = [
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'Node',
  'NodeList',
  'Text',
  'Range',
  'Selection',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'DragEvent',
  'ClipboardEvent',
  'DataTransfer',
  'FileReader',
  'Blob',
  'File',
  'Image',
  'DOMRect',
  'DOMException',
  'MutationObserver',
  'DOMParser',
  'CustomElementRegistry',
];

/** 建一个装了假桥 + 假 fetch 的球窗口（每次都是全新的 jsdom + 全新的 bundle 实例） */
let importCounter = 0;

/** Node 22 有些全局是只读 getter（如 navigator），必须 defineProperty 才写得进去 */
function defineGlobal(key, value) {
  try {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  } catch {
    /* 写不进去就算了：球只在少数路径用到它 */
  }
}

async function openOrb({ html, bundle, bridge, fetchImpl, scenario }) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html.replace(SCRIPT_TAG, ''), {
    url: 'http://localhost/orb/orb.html',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const state = { requests: [], statuses: [], bubbleSnapshots: [] };

  window.electronAPI = bridge;
  const realFetch = async (url, init) => {
    state.requests.push({ url: String(url), body: init?.body, init });
    return await fetchImpl(String(url), init, state);
  };

  defineGlobal('window', window);
  defineGlobal('document', window.document);
  defineGlobal('location', window.location);
  defineGlobal('localStorage', window.localStorage);
  defineGlobal('sessionStorage', window.sessionStorage);
  defineGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  defineGlobal('requestAnimationFrame', (cb) => window.setTimeout(() => cb(Date.now()), 16));
  defineGlobal('cancelAnimationFrame', (id) => window.clearTimeout(id));
  defineGlobal('fetch', realFetch);
  for (const key of GLOBAL_KEYS) {
    const value = window[key];
    if (value !== undefined) defineGlobal(key, value);
  }
  // jsdom 的 execCommand 是 not-implemented 会刷错误日志；球只在粘贴时用到它
  window.document.execCommand = () => false;

  const poll = window.setInterval(() => {
    const text = window.document.querySelector('#status')?.textContent ?? '';
    if (text !== '' && !state.statuses.includes(text)) state.statuses.push(text);
    // [XG-CUSTOM] 流式证据：把"每个时刻的最后一个 assistant 气泡"记下来 → 断言**逐步增长**
    const bubblesNow = [
      ...window.document.querySelectorAll('.transcript-row.assistant .transcript-bubble'),
    ].map((el) => el.textContent);
    const last = bubblesNow[bubblesNow.length - 1];
    if (last !== undefined && state.bubbleSnapshots[state.bubbleSnapshots.length - 1] !== last) {
      state.bubbleSnapshots.push(last);
    }
  }, 20);

  // 每个场景 import 一份**全新的** bundle 实例（query 只是破 ESM 缓存，不加进产物）
  const bundleUrl = `${pathToFileURL(bundle).href}?scenario=${encodeURIComponent(scenario)}&n=${String(importCounter)}`;
  importCounter += 1;
  await import(bundleUrl);

  return {
    window,
    state,
    close: () => {
      window.clearInterval(poll);
      dom.window.close();
    },
  };
}

function defaultOrbApi(method) {
  switch (method) {
    case 'floating.overlayPermission':
      return 'danger-full-access';
    case 'floating.avatarUrl':
      return '';
    case 'backend.status':
      return { state: 'ready', phase: 'ready' };
    case 'floating.sessionId':
      return null;
    case 'floating.setSessionId':
      return 'session-1';
    case 'floating.setExpanded':
      return { horizontal: 'right', vertical: 'up' };
    case 'floating.setSessionRunning':
      return true;
    default:
      return null;
  }
}

function makeBridge({ chatUrl, resolveThrows = false, reachable = true, hint = '' }) {
  const apiCalls = [];
  return {
    apiCalls,
    resolveXiangwoChatUrl: async () => {
      if (resolveThrows) throw new Error('ipc down');
      return { url: chatUrl, reachable, hint };
    },
    orbApi: async (method, args) => {
      apiCalls.push(method);
      return defaultOrbApi(method, args);
    },
    getOrbMode: async () => ['ball', false],
    orbTogglePin: async () => false,
    orbDrag: async () => true,
    orbDragEnd: async () => true,
    orbOpenMain: async () => true,
    orbCollapse: async () => true,
    orbExpand: async () => true,
    onOrbMode: () => () => {},
    orbQuit: async () => true,
  };
}

function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

async function waitFor(predicate, { timeout = 15_000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

function bubbles(state, window) {
  return [...window.document.querySelectorAll('.transcript-bubble')].map((el) => el.textContent);
}

/** 打开球面板 → 发一条消息 → 等 assistant 气泡出现 */
async function sendMessage(orb, text) {
  const { window } = orb;
  // 等 main() 把 UI 装好（bot 下拉填满 = 同步初始化已完成）
  await waitFor(() => window.document.querySelectorAll('#bot option').length > 1);
  await sleep(50);
  const prompt = window.document.querySelector('#prompt');
  prompt.textContent = text;
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document
    .querySelector('#composer')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

function replyResponse(content) {
  return bytesResponse(200, JSON.stringify({ choices: [{ message: { content } }] }), 'application/json');
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => 'application/json' },
    json: async () => ({}),
    text: async () => '{}',
  };
}

/** 普通（非 SSE）响应：带 headers + 可读 body，跟真 fetch 的形状对齐 */
function bytesResponse(status, body, contentType) {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(bytes);
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    body: stream,
    text: async () => body,
  };
}

/**
 * [XG-CUSTOM] 假 SSE 响应（真 ReadableStream）：可以按剧本一块一块推、
 * 也可以"一直静默"（模拟 agent 还在跑、一个字节都没有）或中途 error（模拟连接被掐）。
 */
function sseResponse() {
  const encoder = new TextEncoder();
  let controller;
  const stream = new ReadableStream({
    start(next) {
      controller = next;
    },
  });
  return {
    response: {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: stream,
    },
    /** 真 fetch 在 signal abort 时会让读取失败；这里照做（球点停止/看门狗都靠它） */
    arm(signal) {
      if (signal === undefined || signal === null) return;
      const onAbort = () => {
        try {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        } catch {
          /* 已经关掉了 */
        }
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
    /** 推一个 OpenAI 兼容的 delta 帧 */
    delta(content) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
        )
      );
    },
    /** 推一个状态帧（工具循环里的"agent 正在操作浏览器…"） */
    status(text) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { status: text } }] })}\n\n`)
      );
    },
    /** 推一个空 content 心跳帧 */
    heartbeat() {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '' } }] })}\n\n`)
      );
    },
    done() {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
    end() {
      controller.close();
    },
    fail(error) {
      controller.error(error);
    },
  };
}

async function run() {
  const { html, bundle } = readOrbBundle();
  console.log(`[harness] 产物 bundle: ${bundle}`);

  // ---------- ① 地址来自 preload 解析值 ----------
  {
    console.log('\n① 聊天地址来自 preload 解析值');
    const remoteUrl = 'http://10.239.5.174:8900/v1/chat/completions';
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'remote-url',
      bridge: makeBridge({ chatUrl: remoteUrl }),
      fetchImpl: async () => replyResponse('远端答'),
    });
    await sendMessage(orb, '你好');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t === '远端答'));
    const urls = orb.state.requests.map((item) => item.url);
    check('请求打到 preload 解析出的地址', urls[0] === remoteUrl, `实际 ${urls[0] ?? '(无请求)'}`);
    check('请求只发一次', urls.length === 1, `实际 ${String(urls.length)}`);
    check(
      '回复渲染成气泡',
      bubbles(orb.state, orb.window).includes('远端答'),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    check(
      '请求体是 OpenAI 格式（含 system 前缀）',
      typeof orb.state.requests[0]?.body === 'string' &&
        orb.state.requests[0].body.includes('[XIANGWO_ROUTE=R0]'),
      String(orb.state.requests[0]?.body)
    );
    orb.close();
  }

  // ---------- ② 解析失败回落 127.0.0.1 ----------
  {
    console.log('\n② 解析失败回落 127.0.0.1');
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'fallback',
      bridge: makeBridge({ chatUrl: LOCAL_URL, resolveThrows: true }),
      fetchImpl: async () => replyResponse('本机答'),
    });
    await sendMessage(orb, '你好');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t === '本机答'));
    const urls = orb.state.requests.map((item) => item.url);
    check('回落地址 = http://127.0.0.1:8900/...', urls[0] === LOCAL_URL, `实际 ${urls[0] ?? '(无请求)'}`);
    check('本机兜底仍然成功', bubbles(orb.state, orb.window).includes('本机答'));
    orb.close();
  }

  // ---------- ③ 重试：前两次失败、第三次成功 ----------
  {
    console.log('\n③ 重试：前两次失败、第三次成功 → 只发 3 次请求');
    let attempts = 0;
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'retry',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts <= 2) throw new TypeError('Failed to fetch');
        return replyResponse('第三次成了');
      },
    });
    await sendMessage(orb, '你好');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t === '第三次成了'), {
      timeout: 20_000,
    });
    check('总共 3 次请求', orb.state.requests.length === 3, `实际 ${String(orb.state.requests.length)}`);
    check('最终显示成功', bubbles(orb.state, orb.window).includes('第三次成了'));
    check(
      '重试期间有文案（第 1 次）',
      orb.state.statuses.includes('后端启动中…（第 1 次重试）'),
      JSON.stringify(orb.state.statuses)
    );
    check(
      '重试期间有文案（第 2 次）',
      orb.state.statuses.includes('后端启动中…（第 2 次重试）'),
      JSON.stringify(orb.state.statuses)
    );
    check(
      '最终没有误报调用失败',
      !bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    orb.close();
  }

  // ---------- ④ 4xx 不重试 ----------
  {
    console.log('\n④ 4xx 不重试');
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'http-404',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async () => errorResponse(404),
    });
    await sendMessage(orb, '你好');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败')));
    await sleep(300);
    check('只发 1 次请求', orb.state.requests.length === 1, `实际 ${String(orb.state.requests.length)}`);
    check(
      '显示人话失败文案（含 HTTP 404）',
      bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败: HTTP 404')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    check(
      '失败文案不是 Failed to fetch',
      bubbles(orb.state, orb.window).every((t) => !t.includes('Failed to fetch')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    orb.close();
  }

  // ---------- ⑤ 用户中止不重试 ----------
  {
    console.log('\n⑤ 用户点停止 → 不重试');
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'abort',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await sendMessage(orb, '你好');
    await waitFor(() => orbitRetrySeen(orb), { timeout: 5000 });
    orb.window.document.querySelector('#stop').click();
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t === '（已停止）'));
    await sleep(300);
    check('只发 1 次请求（中止后不再重试）', orb.state.requests.length === 1, `实际 ${String(orb.state.requests.length)}`);
    check(
      '显示（已停止）',
      bubbles(orb.state, orb.window).includes('（已停止）'),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    orb.close();
  }

  // ---------- ⑥ [流式] 5 个 chunk 逐步增长 ----------
  {
    console.log('\n⑥ [流式] 分 5 个 chunk 推 delta.content → 气泡逐步增长 + [DONE] 后结束');
    const sse = sseResponse();
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-incremental',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async (_url, init) => {
        sse.arm(init?.signal);
        return sse.response;
      },
    });
    await sendMessage(orb, '流式测试');
    const finalText = '项我球真流式';
    for (const piece of ['项', '我', '球', '真', '流式']) {
      await sleep(90);
      sse.delta(piece);
    }
    await sleep(150);
    const mid = orb.state.bubbleSnapshots.filter((t) => t !== '' && t !== finalText);
    check(
      '收到 stream:true（请求体里带了）',
      String(orb.state.requests[0]?.body).includes('"stream":true'),
      String(orb.state.requests[0]?.body).slice(0, 200)
    );
    check('中途某一刻气泡已非空', mid.length > 0, JSON.stringify(orb.state.bubbleSnapshots));
    check(
      `气泡逐步增长（中间态 ${String(mid.length)} 个 ≥ 3）`,
      mid.length >= 3,
      JSON.stringify(mid)
    );
    sse.done();
    sse.end();
    await waitFor(() => bubbles(orb.state, orb.window).includes(finalText), { timeout: 10_000 });
    check(
      '最终内容完整（5 段拼齐）',
      bubbles(orb.state, orb.window).includes(finalText),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    const finished = await waitFor(
      () => orb.window.document.body.classList.contains('running') === false
    );
    check('[DONE] 后收工（running 摘掉 / 停止按钮藏起）', finished);
    check(
      '没有误报调用失败',
      !bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    orb.close();
  }

  // ---------- ⑦a [流式] 首字节 20 秒不来 → 重试 ----------
  {
    console.log('\n⑦a [流式] 首字节 20 秒没字节 → 触发重试（第 2 次连上就成功）');
    const dead = sseResponse(); // 永不推字节（模拟连接被中间层黑洞）
    const alive = sseResponse();
    let attempt = 0;
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-first-byte-slow',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async (_url, init) => {
        attempt += 1;
        const stub = attempt === 1 ? dead : alive;
        stub.arm(init?.signal);
        return stub.response;
      },
    });
    await sendMessage(orb, '很慢的一轮');
    const sawRetry = await waitFor(
      () => orb.state.statuses.some((t) => t.startsWith('后端启动中')),
      { timeout: 40_000 }
    );
    check('首字节 20 秒没到 → 催了一次重试', sawRetry, JSON.stringify(orb.state.statuses));
    check(
      '重试期间没有显示 Failed to fetch',
      orb.state.statuses.every((t) => !t.includes('Failed to fetch'))
    );
    alive.delta('第二次连上了');
    alive.done();
    alive.end();
    await waitFor(() => bubbles(orb.state, orb.window).includes('第二次连上了'), { timeout: 30_000 });
    check('重试后拿到完整回答', bubbles(orb.state, orb.window).includes('第二次连上了'));
    check(
      '只发了 2 次请求（1 次 + 1 次重试）',
      orb.state.requests.length === 2,
      `实际 ${String(orb.state.requests.length)}`
    );
    orb.close();
  }

  // ---------- ⑦b [流式] 收到字节后长空闲 70 秒 → 不判失败 ----------
  {
    console.log('\n⑦b [流式] 收到字节后长空闲 70 秒 → 不判失败、显示「已等待 N 秒」');
    const sse = sseResponse();
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-long-idle',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async (_url, init) => {
        sse.arm(init?.signal);
        return sse.response;
      },
    });
    await sendMessage(orb, '长活');
    sse.delta('agent 先回了半句');
    const gotHalf = await waitFor(() => bubbles(orb.state, orb.window).some((t) => t.includes('半句')));
    check('前半句已经渲染出来', gotHalf, JSON.stringify(bubbles(orb.state, orb.window)));
    const sawWaiting = await waitFor(
      () => orb.state.statuses.some((t) => t.startsWith('agent 还在干活…（已等待')),
      { timeout: 15_000 }
    );
    check('空闲时状态区在报「agent 还在干活…（已等待 N 秒）」', sawWaiting, JSON.stringify(orb.state.statuses));
    await sleep(70_000); // 旧代码的 10 秒总窗口早就判死了，新策略必须继续等
    const waited = orb.state.statuses.filter((t) => t.startsWith('agent 还在干活…（已等待'));
    check('70 秒静默期间一直在刷新等待秒数', waited.length >= 5, JSON.stringify(waited));
    const lastWaiting = waited[waited.length - 1] ?? '';
    const lastSeconds = Number(/已等待 (\d+) 秒/.exec(lastWaiting)?.[1] ?? '0');
    check(`等待文案数到了 ${String(lastSeconds)} 秒（≥60）`, lastSeconds >= 60, JSON.stringify(waited));
    check(
      '70 秒静默后没有判失败、也没有清空气泡',
      !bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败')) &&
        bubbles(orb.state, orb.window).some((t) => t.includes('半句')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    check(
      '静默期间没有整轮重发（只 1 个请求）',
      orb.state.requests.length === 1,
      `实际 ${String(orb.state.requests.length)}`
    );
    sse.delta('，现在答完了');
    sse.done();
    sse.end();
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t.includes('现在答完了')));
    check(
      '最终把后面的内容接上了',
      bubbles(orb.state, orb.window).includes('agent 先回了半句，现在答完了'),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    orb.close();
  }

  // ---------- ⑧ [流式] 非 SSE（老服务端 / 代理）→ 整段渲染 ----------
  {
    console.log('\n⑧ [流式] 服务端回普通 JSON（不支持流式）→ 整段渲染，不报错');
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-non-sse-json',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async () =>
        bytesResponse(
          200,
          JSON.stringify({ choices: [{ message: { content: '老格式整段回答' } }] }),
          'application/json; charset=utf-8'
        ),
    });
    await sendMessage(orb, '老服务端');
    const got = await waitFor(() => bubbles(orb.state, orb.window).includes('老格式整段回答'));
    check('整段渲染成气泡', got, JSON.stringify(bubbles(orb.state, orb.window)));
    check(
      '没有报错',
      !bubbles(orb.state, orb.window).some((t) => t.startsWith('调用失败')),
      JSON.stringify(bubbles(orb.state, orb.window))
    );
    check('只发 1 次请求', orb.state.requests.length === 1);
    orb.close();
  }

  // ---------- ⑨ [流式] 流中途断 → 保留部分内容 + 标注 ----------
  {
    console.log('\n⑨ [流式] 流中途断 → 保留部分内容 + 标注「（连接中断，已显示部分内容）」');
    const sse = sseResponse();
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-interrupted',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async (_url, init) => {
        sse.arm(init?.signal);
        return sse.response;
      },
    });
    await sendMessage(orb, '断流');
    sse.delta('前半段内容');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t.includes('前半段内容')));
    sse.fail(new Error('socket hang up'));
    const noted = await waitFor(() =>
      bubbles(orb.state, orb.window).some((t) => t.includes('（连接中断，已显示部分内容）'))
    );
    const text = bubbles(orb.state, orb.window).find((t) => t.includes('连接中断')) ?? '';
    check('保留了已收到的部分内容', text.includes('前半段内容'), text);
    check('下方有人话标注', noted && text.includes('（连接中断，已显示部分内容）'), text);
    check('标注不是 Failed to fetch', !text.includes('Failed to fetch'), text);
    check(
      '断流不整轮重发（只 1 个请求）',
      orb.state.requests.length === 1,
      `实际 ${String(orb.state.requests.length)}`
    );
    orb.close();
  }

  // ---------- ⑩ [流式] 点停止 → abort + 保留已收内容 ----------
  {
    console.log('\n⑩ [流式] 点停止 → 请求被 abort、保留已收内容');
    const sse = sseResponse();
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'sse-stop',
      bridge: makeBridge({ chatUrl: LOCAL_URL }),
      fetchImpl: async (_url, init) => {
        sse.arm(init?.signal);
        return sse.response;
      },
    });
    await sendMessage(orb, '停止');
    sse.delta('先收到的内容');
    await waitFor(() => bubbles(orb.state, orb.window).some((t) => t.includes('先收到的内容')));
    orb.window.document.querySelector('#stop').click();
    const stopped = await waitFor(() =>
      bubbles(orb.state, orb.window).some((t) => t.includes('（已停止）'))
    );
    const text = bubbles(orb.state, orb.window).find((t) => t.includes('已停止')) ?? '';
    check('停止后保留了已收内容', stopped && text.includes('先收到的内容'), text);
    check('标注（已停止）', text.includes('（已停止）'), text);
    const idleAgain = await waitFor(
      () => orb.window.document.body.classList.contains('running') === false
    );
    check('停止后收工（running 摘掉）', idleAgain);
    check(
      '停止不重发（只 1 个请求）',
      orb.state.requests.length === 1,
      `实际 ${String(orb.state.requests.length)}`
    );
    orb.close();
  }
}

function orbitRetrySeen(orb) {
  return orb.state.statuses.some((text) => text.startsWith('后端启动中'));
}

run()
  .then(() => {
    console.log(`\n[harness] 通过 ${String(passes.length)} 项，失败 ${String(failures.length)} 项`);
    if (failures.length > 0) {
      console.log('[harness] 失败项：');
      for (const item of failures) console.log(`  - ${item}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error('[harness] 崩了：', error);
    process.exitCode = 1;
  });
