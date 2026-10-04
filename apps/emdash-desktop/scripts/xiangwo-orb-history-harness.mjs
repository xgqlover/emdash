#!/usr/bin/env node
// [XG-CUSTOM 2026-10-04] 项我球 **侧边枝历史拉回** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`（产出 out/renderer/orb/orb.html + out/renderer/assets/orb-*.js）
// 用法：`node scripts/xiangwo-orb-history-harness.mjs`（在 apps/emdash-desktop 下）
//
// 为什么需要它：这条链路的**恢复分支在真机上走不到** —— 只有本地桶为空（清缓存/换机器）时才触发，
// 而球的 UI 没有"删除会话"入口，没法手工把桶清空。所以只能在 harness 里造"空桶"这个前置条件。
//
// 做法与 xiangwo-orb-chat-harness.mjs / xiangwo-orb-images-harness.mjs 一致：
// 假桥 + 假 fetch + 真产物 bundle + jsdom，驱动真实 UI（切 #bot 触发 change），只断言外部可见的事实。
//
// 断言（含守卫逻辑的回归）：
//   ① 本地桶为空 + 后端有历史 → 发一次 `GET /sidebar/history?bot=<bot>`，把消息渲染进对话，
//      并落进 localStorage 桶；trace 打 `history-restored`
//   ② 本地已有内容 → **一次都不请求** `/sidebar/history`（本地是权威，绝不覆盖），
//      原对话分毫不动；trace 打 `history-restore-skip` + reason=local-messages
//   ③ 默认 bot（空串「项我」）→ 一次都不请求（后端没有它的侧边枝）
//   ④ 拉取失败（网络抛错）→ 不崩、不吞、不提示；聊天仍可继续；trace 打 skip + reason=empty-or-failed
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(HERE, '..', 'out', 'renderer');
const ORB_HTML = resolve(RENDERER_DIR, 'orb', 'orb.html');
const LOCAL_URL = 'http://127.0.0.1:8900/v1/chat/completions';
const LOCAL_BASE = 'http://127.0.0.1:8900';
const HISTORY_RE = /\/sidebar\/history\?/;

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

let importCounter = 0;

/** Node 22 有些全局是只读 getter（如 navigator），必须 defineProperty 才写得进去 */
function defineGlobal(key, value) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    /* 写不进去就算了：球只在少数路径用到它 */
  }
}

/**
 * 起一个球（真产物 bundle + jsdom）。
 * @param seed 载入 bundle **之前**要写进 localStorage 的键值（造"本地桶为空/非空"这个前置条件）
 * @param fetchImpl `(url, init, state) => Promise<{ok, json}>`
 */
async function openOrb({ html, bundle, bridge, fetchImpl, scenario, seed = {} }) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html.replace(SCRIPT_TAG, ''), {
    url: 'http://localhost/orb/orb.html',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const state = { requests: [], statuses: [] };

  window.electronAPI = bridge;
  for (const [key, value] of Object.entries(seed)) window.localStorage.setItem(key, value);

  const realFetch = async (url, init) => {
    state.requests.push({ url: String(url), body: init?.body, method: init?.method });
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
  window.document.execCommand = () => false;
  window.document.elementFromPoint = () => null;
  if (window.Element !== undefined) {
    window.Element.prototype.setPointerCapture = () => {};
    window.Element.prototype.releasePointerCapture = () => {};
  }

  const poll = window.setInterval(() => {
    const text = window.document.querySelector('#status')?.textContent ?? '';
    if (text !== '' && !state.statuses.includes(text)) state.statuses.push(text);
  }, 20);

  const bundleUrl = `${pathToFileURL(bundle).href}?scenario=${encodeURIComponent(scenario)}&n=${String(importCounter)}`;
  importCounter += 1;
  await import(bundleUrl);
  await waitFor(() => window.document.querySelectorAll('#bot option').length > 1);
  await sleep(60); // 让启动序列（sessionId / 基址解析 / backend.status）落定

  return {
    window,
    state,
    bridge,
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

function makeBridge({ chatUrl = LOCAL_URL } = {}) {
  const apiCalls = [];
  const apiArgs = [];
  return {
    apiCalls,
    apiArgs,
    resolveXiangwoChatUrl: async () => ({
      url: chatUrl,
      baseUrl: LOCAL_BASE,
      reachable: true,
      hint: '',
    }),
    orbApi: async (method, args) => {
      apiCalls.push(method);
      apiArgs.push(args);
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

/** 切 bot（真实 UI 路径：#bot 的 change 事件） */
function switchBotTo(window, botId) {
  const select = window.document.querySelector('#bot');
  select.value = botId;
  select.dispatchEvent(new window.Event('change'));
}

function transcriptText(window) {
  return window.document.querySelector('#transcript')?.textContent ?? '';
}

function traceEvents(bridge) {
  return bridge.apiArgs
    .filter((args) => args !== null && typeof args === 'object' && args.event !== undefined)
    .map((args) => args.event);
}

function historyTrace(bridge, event) {
  return bridge.apiArgs.find((args) => args?.event === event);
}

function historyRequests(state) {
  return state.requests.filter((item) => HISTORY_RE.test(item.url));
}

/** 后端 /sidebar/history 的标准应答（对齐 agent.py `_sidebar_history_json` 的真实形状） */
const BACKEND_HISTORY = {
  title: '打开 G-Mark',
  messages: [
    { role: 'user', content: '打开 G-Mark', timestamp: '2026-10-02T14:10:41' },
    { role: 'assistant', content: '打开了 G-Mark 官网', timestamp: '2026-10-02T14:10:42' },
  ],
};

const okJson = (payload) => ({ ok: true, json: async () => payload });

async function run() {
  const { html, bundle } = readOrbBundle();
  console.log(`[history-harness] 产物：${bundle}`);

  // ── ① 本地桶为空 + 后端有历史 → 拉回 ────────────────────────────────────────────
  {
    console.log('\n① 本地桶为空 → 从后端拉回侧边历史');
    const bridge = makeBridge();
    const orb = await openOrb({
      html,
      bundle,
      bridge,
      scenario: 'restore',
      fetchImpl: async (url) => (HISTORY_RE.test(url) ? okJson(BACKEND_HISTORY) : okJson({})),
    });
    const { window, state } = orb;
    switchBotTo(window, 'sxsj');
    await waitFor(() => transcriptText(window).includes('打开了 G-Mark 官网'));
    await sleep(60);

    const calls = historyRequests(state);
    check('发了且只发了一次 /sidebar/history', calls.length === 1, `实际 ${String(calls.length)} 次`);
    check(
      'URL 带 bot=sxsj 且用 GET',
      calls[0]?.url === `${LOCAL_BASE}/sidebar/history?bot=sxsj` && calls[0]?.method === 'GET',
      JSON.stringify({ url: calls[0]?.url, method: calls[0]?.method })
    );
    check('后端两条消息都渲染进对话', transcriptText(window).includes('打开 G-Mark'));
    check(
      '后端 title 成为会话标题（历史菜单里可见）',
      (window.document.querySelector('#history-menu')?.textContent ?? window.localStorage.getItem('xiangwo-orb-conversations:sxsj') ?? '').includes(
        '打开 G-Mark'
      )
    );
    const stored = JSON.parse(window.localStorage.getItem('xiangwo-orb-conversations:sxsj') ?? '[]');
    check(
      '落进 localStorage 桶（换机器后本地也有）',
      Array.isArray(stored) && stored[0]?.messages?.length === 2,
      JSON.stringify(stored).slice(0, 120)
    );
    check(
      '面板状态告知已拉回',
      state.statuses.some((text) => text.includes('已从后端拉回 2 条')),
      JSON.stringify(state.statuses)
    );
    check('trace = history-restored', traceEvents(bridge).includes('history-restored'), JSON.stringify(traceEvents(bridge)));
    orb.close();
  }

  // ── ② 守卫：本地已有内容 → 一次都不请求 ─────────────────────────────────────────
  {
    console.log('\n② 本地已有内容 → 绝不覆盖、绝不请求');
    const bridge = makeBridge();
    const seeded = [
      {
        id: 'local-1',
        title: '本地那条',
        botId: 'sxsj',
        messages: [{ role: 'user', text: '本地已存在的消息' }],
      },
    ];
    const orb = await openOrb({
      html,
      bundle,
      bridge,
      scenario: 'guard-local',
      seed: { 'xiangwo-orb-conversations:sxsj': JSON.stringify(seeded) },
      fetchImpl: async (url) => (HISTORY_RE.test(url) ? okJson(BACKEND_HISTORY) : okJson({})),
    });
    const { window, state } = orb;
    switchBotTo(window, 'sxsj');
    await sleep(150);

    check('一次都没请求 /sidebar/history', historyRequests(state).length === 0);
    check('本地对话原样保留（没被后端历史覆盖）', transcriptText(window).includes('本地已存在的消息'));
    check('没渲染后端那条', !transcriptText(window).includes('打开了 G-Mark 官网'));
    const skip = historyTrace(bridge, 'history-restore-skip');
    check('trace = history-restore-skip / local-messages', skip?.reason === 'local-messages', JSON.stringify(skip));
    orb.close();
  }

  // ── ③ 默认 bot（空串）→ 一次都不请求 ────────────────────────────────────────────
  {
    console.log('\n③ 默认 bot（项我）→ 跳过（后端没有它的侧边枝）');
    const bridge = makeBridge();
    const orb = await openOrb({
      html,
      bundle,
      bridge,
      scenario: 'skip-default',
      fetchImpl: async (url) => (HISTORY_RE.test(url) ? okJson(BACKEND_HISTORY) : okJson({})),
    });
    const { window, state } = orb;
    switchBotTo(window, '');
    await sleep(150);

    check('一次都没请求 /sidebar/history', historyRequests(state).length === 0);
    check('对话没被塞进东西', !transcriptText(window).includes('打开了 G-Mark 官网'));
    orb.close();
  }

  // ── ④ 拉取失败 → 静默降级，不崩不吞 ─────────────────────────────────────────────
  {
    console.log('\n④ 拉取失败 → 静默降级（不崩、不提示、聊天照常）');
    const bridge = makeBridge();
    const orb = await openOrb({
      html,
      bundle,
      bridge,
      scenario: 'fetch-fail',
      fetchImpl: async (url) => {
        if (HISTORY_RE.test(url)) throw new Error('ECONNREFUSED');
        return okJson({});
      },
    });
    const { window, state } = orb;
    switchBotTo(window, 'sxsj');
    await sleep(150);

    check('请求发出过（证明接线真的走到了）', historyRequests(state).length === 1);
    check('没渲染任何后端消息', !transcriptText(window).includes('打开了 G-Mark 官网'));
    check('没有报错状态文字', !state.statuses.some((text) => text.includes('失败') || text.includes('错误')));
    const skip = historyTrace(bridge, 'history-restore-skip');
    check('trace = history-restore-skip / empty-or-failed', skip?.reason === 'empty-or-failed', JSON.stringify(skip));
    orb.close();
  }
}

run()
  .then(() => {
    console.log(`\n[history-harness] 通过 ${String(passes.length)} 项，失败 ${String(failures.length)} 项`);
    if (failures.length > 0) {
      console.log('[history-harness] 失败项：');
      for (const item of failures) console.log(`  - ${item}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error('[history-harness] 崩了：', error);
    process.exitCode = 1;
  });
