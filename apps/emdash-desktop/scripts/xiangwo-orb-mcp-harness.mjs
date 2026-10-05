#!/usr/bin/env node
// [XG-CUSTOM 2026-10-05] 项我球**MCP 工具市场卡** harness —— 跑**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`；用法：`node scripts/xiangwo-orb-mcp-harness.mjs`
// 手法沿用 chat/question harness：jsdom 载入产物 html + 假桥 + 假 SSE，只断言外部可见事实。
//
// 断言：
//   ① 市场块 → 渲染出卡片（标题计数 + 每服务器一张卡）
//   ② 传输/健康徽标 + 调用统计 + 密钥**只显示键名**
//   ③ 写类工具带标记与提示（审批卡）
//   ④ 分面过滤：输入框同时过滤服务器名与工具名
//   ⑤ ★解析链回归：**同一条消息里市场块 + 提问块** → 两张卡都渲染、气泡里两块都被摘掉
//      （我在解析链里插了 MCP 一环，这条就是防「插一环把后面那环吃掉」）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(HERE, '..', 'out', 'renderer');
const ORB_HTML = resolve(RENDERER_DIR, 'orb', 'orb.html');
const CHAT_URL = 'http://127.0.0.1:8900/v1/chat/completions';

const passes = [];
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passes.push(label);
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`);
    console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`);
  }
}

function readOrbBundle() {
  const html = readFileSync(ORB_HTML, 'utf8');
  const match = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html);
  if (match === null) throw new Error(`产物 html 里找不到 module script: ${ORB_HTML}`);
  return { html, bundle: resolve(dirname(ORB_HTML), match[1]) };
}

const SCRIPT_TAG = /<script[^>]*type="module"[^>]*><\/script>/;
const GLOBAL_KEYS = [
  'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Element', 'HTMLElement',
  'HTMLInputElement', 'Node', 'NodeList', 'Text', 'Range', 'Selection', 'Event', 'CustomEvent',
  'MouseEvent', 'KeyboardEvent', 'DragEvent', 'ClipboardEvent', 'DataTransfer', 'FileReader',
  'Blob', 'File', 'Image', 'DOMRect', 'DOMException', 'MutationObserver', 'DOMParser',
  'CustomElementRegistry',
];

let importCounter = 0;

function defineGlobal(key, value) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    /* 写不进去就算了 */
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(predicate, { timeout = 15_000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

function sseOnce(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`)
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
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

function makeBridge() {
  return {
    resolveXiangwoChatUrl: async () => ({ url: CHAT_URL, reachable: true, hint: '' }),
    orbApi: async (method) => defaultOrbApi(method),
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

async function openOrb({ html, bundle, reply }) {
  const dom = new JSDOM(html.replace(SCRIPT_TAG, ''), {
    url: 'http://localhost/orb/orb.html',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  window.electronAPI = makeBridge();
  defineGlobal('window', window);
  defineGlobal('document', window.document);
  defineGlobal('location', window.location);
  defineGlobal('localStorage', window.localStorage);
  defineGlobal('sessionStorage', window.sessionStorage);
  defineGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  defineGlobal('requestAnimationFrame', (cb) => window.setTimeout(() => cb(Date.now()), 16));
  defineGlobal('cancelAnimationFrame', (id) => window.clearTimeout(id));
  defineGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: sseOnce(reply),
    text: async () => reply,
  }));
  for (const key of GLOBAL_KEYS) {
    const value = window[key];
    if (value !== undefined) defineGlobal(key, value);
  }
  window.document.execCommand = () => false;
  const bundleUrl = `${pathToFileURL(bundle).href}?mcp=${String(importCounter)}`;
  importCounter += 1;
  await import(bundleUrl);
  return { window, close: () => dom.window.close() };
}

async function sendMessage(orb, text) {
  const { window } = orb;
  await waitFor(() => window.document.querySelectorAll('#bot option').length > 1);
  await sleep(50);
  const prompt = window.document.querySelector('#prompt');
  prompt.textContent = text;
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document
    .querySelector('#composer')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

const MARKET = {
  servers: [
    {
      name: 'openviking',
      transport: 'http',
      target: 'http://127.0.0.1:1933/mcp',
      enabled: true,
      toolCount: 15,
      tools: ['find', 'search', 'remember', 'write'],
      writeTools: ['remember', 'write'],
      secretKeys: ['headers.Authorization'],
      calls: 2,
      failures: 0,
      maxMs: 756,
      enumFailed: false,
    },
    {
      name: 'WeKnora',
      transport: 'stdio',
      target: 'python weknora_mcp_server.py',
      enabled: true,
      toolCount: 28,
      tools: ['hybrid_search', 'list_tenants'],
      writeTools: ['create_knowledge_base'],
      secretKeys: ['env.WEKNORA_API_KEY'],
      calls: 0,
      failures: 1,
      maxMs: 2300,
      enumFailed: false,
    },
  ],
  totals: { servers: 2, tools: 43, writeTools: 3, calls: 2 },
  catalogAgeSeconds: 120,
};

const marketBlock = () => '```xiangwo-mcp\n' + JSON.stringify(MARKET) + '\n```';
const questionBlock = () =>
  '```xiangwo-question\n' +
  JSON.stringify({
    questions: [{ id: 'q1', header: '风格', question: '选哪个？', options: ['国潮', '波普'] }],
    allowCustom: false,
  }) +
  '\n```';

async function main() {
  const { html, bundle } = readOrbBundle();
  console.log('项我球 · MCP 工具市场卡 harness（跑产物 out/renderer）\n');

  console.log('① 市场卡渲染');
  {
    const orb = await openOrb({
      html,
      bundle,
      reply: `这是你的工具市场：\n\n${marketBlock()}\n\n需要我打开某个工具吗？`,
    });
    const { window } = orb;
    await sendMessage(orb, '看看工具市场');
    await waitFor(() => window.document.querySelector('.mcp-market') !== null);
    const market = window.document.querySelector('.mcp-market');
    check('① 渲染出 .mcp-market 卡片', market !== null);
    const title = market?.querySelector('.mcp-market-title')?.textContent ?? '';
    check('② 标题含总数（2 服务器 / 43 工具 / 写类 3 / 调用 2 次）',
      title.includes('2 个服务器') && title.includes('43 个工具') &&
      title.includes('写类 3') && title.includes('调用过 2 次'), title);
    check('③ 每个服务器一张卡', market?.querySelectorAll('.mcp-server').length === 2,
      String(market?.querySelectorAll('.mcp-server').length));
    check('④ 传输徽标 + 健康徽标 + 计数',
      (market?.textContent ?? '').includes('http') &&
      (market?.textContent ?? '').includes('可用') &&
      (market?.textContent ?? '').includes('28 工具'),
      (market?.querySelector('.mcp-server-head')?.textContent ?? '').slice(0, 80));
    check('⑤ 有失败调用的服务器显示 warn 徽标',
      (market?.textContent ?? '').includes('1 次失败'));
    check('⑥ 密钥只显示键名（不回显值）',
      (market?.textContent ?? '').includes('headers.Authorization') &&
      (market?.textContent ?? '').includes('env.WEKNORA_API_KEY'));
    const writeChips = [...(market?.querySelectorAll('.mcp-tool-write') ?? [])].map((n) => n.textContent);
    check('⑦ 写类工具带标记', writeChips.includes('write') && writeChips.includes('remember'),
      writeChips.join(','));
    check('⑧ 写类工具有审批提示 title',
      (market?.querySelector('.mcp-tool-write')?.getAttribute('title') ?? '').includes('审批卡'));

    console.log('② 分面过滤');
    const filter = market?.querySelector('.mcp-market-filter');
    const cards = [...(market?.querySelectorAll('.mcp-server') ?? [])];
    filter.value = 'weknora';
    filter.dispatchEvent(new window.Event('input'));
    check('⑨ 按服务器名过滤', cards[0].hidden === true && cards[1].hidden === false);
    filter.value = 'hybrid_search';
    filter.dispatchEvent(new window.Event('input'));
    check('⑩ 按工具名过滤（服务器名不含它也能筛出）',
      cards[0].hidden === true && cards[1].hidden === false);
    filter.value = '';
    filter.dispatchEvent(new window.Event('input'));
    check('⑪ 清空过滤恢复全部', cards.every((c) => !c.hidden));

    const bubbles = [...window.document.querySelectorAll('.transcript-bubble')].map((n) => n.textContent ?? '');
    check('⑫ 市场块从气泡正文里摘掉（不残留 JSON）',
      bubbles.every((b) => !b.includes('xiangwo-mcp') && !b.includes('"servers"')),
      bubbles.join(' | ').slice(0, 120));
    orb.close();
  }

  console.log('③ ★解析链回归：同一条消息里市场块 + 提问块');
  {
    const orb = await openOrb({
      html,
      bundle,
      reply: `两张卡都给你：\n\n${marketBlock()}\n\n${questionBlock()}\n\n选完告诉我。`,
    });
    const { window } = orb;
    await sendMessage(orb, '既要市场也要选项');
    await waitFor(
      () =>
        window.document.querySelector('.mcp-market') !== null &&
        window.document.querySelector('.question-card') !== null
    );
    check('⑬ 市场卡渲染', window.document.querySelector('.mcp-market') !== null);
    check('⑭ 提问卡也渲染（插一环没吃掉后面那环）',
      window.document.querySelector('.question-card') !== null);
    const bubbles = [...window.document.querySelectorAll('.transcript-bubble')].map((n) => n.textContent ?? '');
    check('⑮ 两块都从正文摘掉，正文只留人话',
      bubbles.some((b) => b.includes('两张卡都给你')) &&
      bubbles.every((b) => !b.includes('xiangwo-mcp') && !b.includes('xiangwo-question')),
      bubbles.join(' | ').slice(0, 140));
    orb.close();
  }

  console.log(`\n通过 ${String(passes.length)} / ${String(passes.length + failures.length)}`);
  if (failures.length > 0) {
    console.log('\n失败项：');
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

await main();
