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
//   ③ 前两次 fetch 失败、第三次成功 → 只发 3 次请求 + 最终显示成功 + 重试文案出现过
//   ④ 4xx 不重试（只发 1 次）
//   ⑤ 用户中止不重试（只发 1 次，显示「（已停止）」）
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
  const state = { requests: [], statuses: [] };

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
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function errorResponse(status) {
  return { ok: false, status, json: async () => ({}) };
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
      '显示调用失败: HTTP 404',
      bubbles(orb.state, orb.window).includes('调用失败: HTTP 404'),
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
