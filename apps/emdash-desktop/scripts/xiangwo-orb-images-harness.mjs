#!/usr/bin/env node
// [XG-CUSTOM] 项我球 **图片网格协议（xiangwo-images）** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`（产出 out/renderer/orb/orb.html + out/renderer/assets/orb-*.js）
// 用法：`node scripts/xiangwo-orb-images-harness.mjs`（在 apps/emdash-desktop 下）
//
// 做法与 xiangwo-orb-chat-harness.mjs 一致（假桥 + 假 fetch + 真产物 bundle + jsdom）：
// 载入产物 orb.html，把 window.electronAPI 和 fetch 换成假的，再动态 import 产物 bundle，
// 驱动真实 UI（填 #prompt → submit），只断言外部可见的事实。
//
// 断言（含既有行为的回归）：
//   ① 含 xiangwo-images 的回复 → 渲染成图片网格（条数 / <img src> / lazy / no-referrer / 域名角标）
//   ①b [XG-CUSTOM 2026-10-03] **相对地址**（/xg/img?u=…）按 agent baseUrl 拼成绝对 URL
//   ② [XG-CUSTOM 2026-10-03] 点格子 → 调 host.openEmbeddedBrowser(**来源作品页 page**)；
//      没有 page 的格子不可点（也不悄悄开系统浏览器 —— 不许有 host.openExternal）
//   ③ 图片加载失败 → 占位（写着"图片加载失败" + 地址），点它仍然开来源作品页
//   ④ 坏 JSON / 无合法 url → 整段当普通文本**不吞消息**、不出网格
//   ⑤ 块不残留在气泡文字里
//   ⑥ 历史只落 url 列表（≤24 条）、**不含 dataURL**
//   ⑦ 回归：提问卡（块不残留 / 点选项发出去）
//   ⑧ 回归：权限档（切只读 → 下一条请求的 system 前缀带 read-only）
//   ⑨ 回归：单击球 = 展开面板 / 双击球 = 打开主窗（双击撤销那下切换）
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(HERE, '..', 'out', 'renderer');
const ORB_HTML = resolve(RENDERER_DIR, 'orb', 'orb.html');
const LOCAL_URL = 'http://127.0.0.1:8900/v1/chat/completions';
/** [XG-CUSTOM 2026-10-03] 假主进程给的 agent 基址（相对地址 /xg/img?u=… 靠它拼绝对） */
const LOCAL_BASE = 'http://127.0.0.1:8900';
const STORE_KEY = 'xiangwo-orb-conversations:__default';

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
  const state = { requests: [], statuses: [], external: [] };

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
  window.document.execCommand = () => false;
  // jsdom 没实现 elementFromPoint：球的 TEMP-TRACE（ballDebug）会调它
  window.document.elementFromPoint = () => null;
  // jsdom 没实现指针捕获：球的自绘拖动会调用它，补个 no-op（不影响手势逻辑断言）
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
  await sleep(30);

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
    // [XG-CUSTOM 2026-10-03] 图片卡片点击 → 内嵌浏览器开来源页（真实主进程见 xiangwo-orb-api.ts）
    case 'host.openEmbeddedBrowser':
      return { ok: true };
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
    openedMain: 0,
    resolveXiangwoChatUrl: async () => ({
      url: chatUrl,
      // [XG-CUSTOM 2026-10-03] 主进程解析出来的 agent 基址（真实实现见 main/host/xiangwo-chat-target.ts）
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
    orbOpenMain: async () => {
      return true;
    },
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

function replyResponse(content) {
  const body = JSON.stringify({ choices: [{ message: { content } }] });
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => JSON.parse(body),
    // [XG-CUSTOM 2026-10-03] 球现在走 SSE 流式通道（见 xiangwo-chat.ts 的文件头 9)）：服务端回
    // 非 event-stream 时整段当回答，但**必须先读得到 text()** —— 少了它整轮会被判成
    // 「连接建立了但没有回任何数据」→ 网格根本不出现（本 harness 之前就是这么坏掉的）。
    text: async () => body,
  };
}

function bubbles(orb) {
  return [...orb.window.document.querySelectorAll('.transcript-bubble')].map((el) => el.textContent);
}

/** 面板打开 → 发一条消息 → 等 assistant 气泡出现 */
async function sendMessage(orb, text) {
  const { window } = orb;
  const prompt = window.document.querySelector('#prompt');
  prompt.textContent = text;
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  window.document
    .querySelector('#composer')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

/** 用回复内容造一个球（假桥 + 一条假回复），返回 { orb, reply } */
async function orbWithReply(scenario, content) {
  const { html, bundle } = readOrbBundle();
  const bridge = makeBridge();
  const orb = await openOrb({
    html,
    bundle,
    scenario,
    bridge,
    fetchImpl: async () => replyResponse(content),
  });
  orb.bridge = bridge;
  await sendMessage(orb, '搜图');
  await waitFor(() => bubbles(orb).some((t) => t !== '搜图' && t.includes('搜')));
  await waitFor(() => orb.window.document.querySelectorAll('.transcript-row.assistant').length > 0);
  // 等持久化（send 的 finally）落盘
  await sleep(80);
  return orb;
}

function imagesBlock(payload) {
  return '```xiangwo-images\n' + JSON.stringify(payload) + '\n```';
}

function samplePayload(title = '图搜 · baking brush') {
  return {
    title,
    images: [
      {
        url: 'https://img.example.com/a_full.jpg',
        thumb: 'https://img.example.com/a_thumb.jpg',
        alt: '烘焙刷 A',
        source: 'searxng',
        page: 'https://www.zcool.com.cn/work/Z1.html',
      },
      {
        url: 'https://img.example.com/b.jpg',
        alt: '烘焙刷 B',
        source: 'searxng',
        page: 'https://searxng.example/landing/2',
      },
      // 没有 page 的一条：按协议**不可点**（也绝不悄悄开系统浏览器）
      { url: 'https://img.example.com/c.jpg', alt: '', source: 'zcool' },
    ],
  };
}

/** [XG-CUSTOM 2026-10-03] agent 侧改成走自己的图片代理（/xg/img?u=…）：相对地址要靠 agent 基址拼绝对 */
function relativePayload() {
  return {
    title: '图搜 · 相对地址',
    images: [
      {
        url: '/xg/img?u=https%3A%2F%2Fp3-pc-sign.douyinpic.com%2Fa.jpg',
        alt: '抖音直链代理',
        source: 'searxng',
        page: '/xg/page?id=7',
      },
      { url: 'https://img.example.com/abs.jpg', alt: '绝对地址', source: 'web' },
    ],
  };
}

async function run() {
  const { bundle } = readOrbBundle();
  console.log(`[images-harness] 产物 bundle: ${bundle}`);

  // ---------- ① 渲染图片网格 ----------
  {
    console.log('\n① xiangwo-images → 图片网格（条数 / src / lazy / no-referrer）');
    const orb = await orbWithReply(
      'images-grid',
      '搜到 3 张图，看看有没有你想要的：\n\n' + imagesBlock(samplePayload())
    );
    const doc = orb.window.document;
    const cells = [...doc.querySelectorAll('.image-cell')];
    const imgs = [...doc.querySelectorAll('.image-cell img.image-thumb')];
    check('渲染出网格容器 .image-grid', doc.querySelectorAll('.image-grid').length === 1);
    check('格子数 = 图片数 3', cells.length === 3, `实际 ${String(cells.length)}`);
    check(
      '第 1 格 src = thumb（有 thumb 用 thumb）',
      imgs[0]?.getAttribute('src') === 'https://img.example.com/a_thumb.jpg',
      String(imgs[0]?.getAttribute('src'))
    );
    check(
      '第 2 格 src = 原图（无 thumb 回落 url）',
      imgs[1]?.getAttribute('src') === 'https://img.example.com/b.jpg',
      String(imgs[1]?.getAttribute('src'))
    );
    check('全部懒加载 loading=lazy', imgs.every((i) => i.getAttribute('loading') === 'lazy'));
    check(
      '全部 referrerpolicy=no-referrer',
      imgs.every((i) => i.getAttribute('referrerpolicy') === 'no-referrer'),
      JSON.stringify(imgs.map((i) => i.getAttribute('referrerpolicy')))
    );
    check(
      '标题渲染出来',
      doc.querySelector('.image-grid-title')?.textContent === '图搜 · baking brush'
    );
    check(
      '说明文字（alt/source）渲染出来',
      cells[0]?.querySelector('.image-caption')?.textContent === '烘焙刷 A' &&
        cells[2]?.querySelector('.image-caption')?.textContent === 'zcool'
    );
    check(
      "角上显示来源域名（page 的 host，取不到用 source）",
      cells[0]?.querySelector('.image-domain')?.textContent === 'www.zcool.com.cn' &&
        cells[2]?.querySelector('.image-domain')?.textContent === 'zcool',
      JSON.stringify(cells.map((c) => c.querySelector('.image-domain')?.textContent))
    );
    orb.close();
  }

  // ---------- ①b 相对地址 → 按 agent 基址拼绝对 ----------
  {
    console.log('\n①b 相对地址 /xg/img?u=… → 按 agent baseUrl 拼成绝对 URL');
    const orb = await orbWithReply('images-relative', imagesBlock(relativePayload()));
    const doc = orb.window.document;
    const imgs = [...doc.querySelectorAll('.image-cell img.image-thumb')];
    check(
      '第 1 格 src = agent 基址 + 相对路径',
      imgs[0]?.getAttribute('src') ===
        `${LOCAL_BASE}/xg/img?u=https%3A%2F%2Fp3-pc-sign.douyinpic.com%2Fa.jpg`,
      String(imgs[0]?.getAttribute('src'))
    );
    check(
      '第 2 格（绝对地址）原样用，没被 base 套一层',
      imgs[1]?.getAttribute('src') === 'https://img.example.com/abs.jpg',
      String(imgs[1]?.getAttribute('src'))
    );
    check(
      '整卡可点：title = 拼成绝对的来源作品页',
      doc.querySelectorAll('.image-cell')[0]?.title === `${LOCAL_BASE}/xg/page?id=7`,
      String(doc.querySelectorAll('.image-cell')[0]?.title)
    );
    orb.close();
  }

  // ---------- ② 点格子开**来源作品页**（内嵌浏览器） ----------
  {
    console.log('\n② 点格子 → host.openEmbeddedBrowser(来源作品页)；没有 page 的格子不可点');
    const orb = await orbWithReply('images-click', imagesBlock(samplePayload()));
    const doc = orb.window.document;
    const cells = [...doc.querySelectorAll('.image-cell')];
    check(
      '有 page 的格子可点（image-cell-clickable → 手型）',
      cells[1]?.className.includes('image-cell-clickable'),
      String(cells[1]?.className)
    );
    check(
      '没有 page 的格子不可点（image-cell-static）',
      cells[2]?.className.includes('image-cell-static'),
      String(cells[2]?.className)
    );
    check('格子 title = 完整来源作品页', cells[1]?.title === 'https://searxng.example/landing/2');
    cells[1].click();
    await sleep(20);
    const opened = orb.bridge.apiCalls.filter((m) => m === 'host.openEmbeddedBrowser').length;
    const systemOpened = orb.bridge.apiCalls.filter((m) => m === 'host.openExternal').length;
    const lastArgs = [...orb.bridge.apiArgs].reverse().find((a) => a?.url !== undefined);
    check('点击触发 host.openEmbeddedBrowser（内嵌浏览器）', opened === 1, `实际 ${String(opened)}`);
    check('绝不开系统浏览器（没有 host.openExternal）', systemOpened === 0, `实际 ${String(systemOpened)}`);
    check(
      '开的是来源作品页（不是图片直链）',
      lastArgs?.url === 'https://searxng.example/landing/2',
      String(lastArgs?.url)
    );
    // 没有 page 的格子：点了什么都不开
    cells[2]?.click();
    await sleep(20);
    check(
      '没有 page 的格子点了不开页',
      orb.bridge.apiCalls.filter((m) => m === 'host.openEmbeddedBrowser').length === 1
    );
    orb.close();
  }

  // ---------- ②b 带 bot → 开页请求带 bot（落到该 bot 的浏览器 profile） ----------
  {
    console.log('\n②b 选了 bot → 开页请求带上 bot 维度（切 bot 会换会话桶，所以先切再发消息）');
    const { html, bundle } = readOrbBundle();
    const bridge = makeBridge();
    const orb = await openOrb({
      html,
      bundle,
      scenario: 'images-click-bot',
      bridge,
      fetchImpl: async () => replyResponse(imagesBlock(samplePayload())),
    });
    const doc = orb.window.document;
    const select = doc.querySelector('#bot');
    const second = select.options[1];
    select.value = second.value;
    select.dispatchEvent(new orb.window.Event('change'));
    await sleep(30);
    await sendMessage(orb, '搜图');
    await waitFor(() => doc.querySelectorAll('.image-cell').length === 3);
    doc.querySelectorAll('.image-cell')[1]?.click();
    await sleep(20);
    const lastArgs = [...bridge.apiArgs].reverse().find((a) => a?.url !== undefined);
    check(
      '开页请求带上了当前 bot（落到该 bot 的浏览器 profile）',
      second !== undefined && lastArgs?.bot === second.value,
      JSON.stringify(lastArgs)
    );
    orb.close();
  }

  // ---------- ③ 加载失败 → 占位 ----------
  {
    console.log('\n③ 图片加载失败 → 先换原图重试，再显示占位（文字 + 域名，点它仍开来源作品页）');
    const orb = await orbWithReply('images-error', imagesBlock(samplePayload()));
    const doc = orb.window.document;
    const firstImg = doc.querySelector('.image-cell img.image-thumb');
    // jsdom 不加载图片资源，手动派发 error 模拟防盗链/404
    firstImg.dispatchEvent(new orb.window.Event('error'));
    await sleep(20);
    check(
      'thumb 挂了先换原图再试一次',
      firstImg.getAttribute('src') === 'https://img.example.com/a_full.jpg' &&
        doc.querySelector('.image-cell .image-fallback') === null,
      String(firstImg.getAttribute('src'))
    );
    firstImg.dispatchEvent(new orb.window.Event('error'));
    await sleep(20);
    const fallback = doc.querySelector('.image-cell .image-fallback');
    check('两次都失败 → 出现加载失败占位', fallback !== null);
    check(
      '失败的 <img> 真的不显示（.image-thumb 的 display:block 会盖掉 [hidden] → 必须内联 display:none）',
      firstImg.style.display === 'none',
      `style.display=${firstImg.style.display}`
    );
    check(
      '占位写着「图片加载失败」+ 完整地址',
      fallback?.querySelector('.image-fallback-text')?.textContent === '图片加载失败' &&
        fallback?.querySelector('.image-fallback-url')?.textContent ===
          'https://www.zcool.com.cn/work/Z1.html',
      JSON.stringify([
        fallback?.querySelector('.image-fallback-text')?.textContent,
        fallback?.querySelector('.image-fallback-url')?.textContent,
      ])
    );
    check(
      '退化卡仍然带域名角标（文字 + 域名，可点）',
      doc.querySelector('.image-cell.failed .image-domain')?.textContent === 'www.zcool.com.cn'
    );
    const cell = doc.querySelector('.image-cell.failed');
    cell.click();
    await sleep(20);
    const lastArgs = [...orb.bridge.apiArgs].reverse().find((a) => a?.url !== undefined);
    check(
      '失败格子仍能开来源作品页',
      lastArgs?.url === 'https://www.zcool.com.cn/work/Z1.html',
      String(lastArgs?.url)
    );
    orb.close();
  }

  // ---------- ④ 坏 JSON / 无合法 url → 普通文本 ----------
  {
    console.log('\n④ 坏 JSON / 无合法 url → 当普通文本（不吞消息、不出网格）');
    const broken = await orbWithReply(
      'images-broken',
      '这是坏的块：\n\n```xiangwo-images\n{"images":[{"url":}]}\n```\n'
    );
    const brokenDoc = broken.window.document;
    check('坏 JSON 不渲染网格', brokenDoc.querySelectorAll('.image-grid').length === 0);
    check(
      '坏 JSON 的原文保留在气泡里（没吞消息）',
      bubbles(broken).some((t) => t.includes('xiangwo-images') && t.includes('这是坏的块')),
      JSON.stringify(bubbles(broken))
    );
    broken.close();

    const noUrl = await orbWithReply(
      'images-nourl',
      '没有合法地址：\n\n' +
        imagesBlock({ images: [{ url: 'ftp://x/a.png' }, { url: 'data:image/png;base64,AAAA' }] })
    );
    const noUrlDoc = noUrl.window.document;
    check('无 http(s) url 不渲染网格', noUrlDoc.querySelectorAll('.image-grid').length === 0);
    check(
      '无合法 url 时原文保留',
      bubbles(noUrl).some((t) => t.includes('没有合法地址') && t.includes('xiangwo-images')),
      JSON.stringify(bubbles(noUrl))
    );
    noUrl.close();
  }

  // ---------- ⑤ 块不残留在气泡里 ----------
  {
    console.log('\n⑤ 块本身不残留在气泡文字里（与提问卡一致）');
    const orb = await orbWithReply(
      'images-clean',
      '这 3 张不错：\n\n' + imagesBlock(samplePayload())
    );
    const texts = bubbles(orb);
    check(
      '气泡里没有 ```xiangwo-images 残留',
      texts.every((t) => !t.includes('xiangwo-images')),
      JSON.stringify(texts)
    );
    check(
      '文字部分保留',
      texts.some((t) => t.includes('这 3 张不错')),
      JSON.stringify(texts)
    );
    orb.close();
  }

  // ---------- ⑥ 历史只落 url 列表、不含 dataURL ----------
  {
    console.log('\n⑥ 历史只落 url 列表（≤24 条）、不含 dataURL');
    const many = {
      title: '30 张',
      images: Array.from({ length: 30 }, (_, i) => ({
        url: `https://img.example.com/${String(i)}.jpg`,
        alt: `图 ${String(i)}`,
      })),
    };
    const orb = await orbWithReply('images-store', imagesBlock(many));
    check('在线视图渲染 30 格（协议上限 60）', orb.window.document.querySelectorAll('.image-cell').length === 30);
    let stored = '';
    try {
      stored = orb.window.localStorage.getItem(STORE_KEY) ?? '';
    } catch {
      stored = '';
    }
    check('历史里存到了这条会话', stored.includes('xiangwo-images'), stored.slice(0, 120));
    check('历史里不含 dataURL', !stored.includes('data:'), stored.slice(0, 200));
    // 从落盘文本里把块解出来数一数（会话 JSON 是转义的，不能用字符串正则直接数）
    let imagesInStore = -1;
    try {
      const list = JSON.parse(stored);
      const assistantText = list
        .flatMap((item) => item.messages ?? [])
        .filter((message) => message.role === 'assistant')
        .map((message) => message.text ?? '')
        .join('\n');
      const match = /```xiangwo-images\s*([\s\S]*?)```/.exec(assistantText);
      if (match !== null) imagesInStore = (JSON.parse(match[1]).images ?? []).length;
    } catch {
      imagesInStore = -1;
    }
    check('历史只留前 24 条 url', imagesInStore === 24, `实际 ${String(imagesInStore)}`);
    orb.close();
  }

  // ---------- ⑦ 回归：提问卡 ----------
  {
    console.log('\n⑦ 回归：提问卡（渲染 / 点选项 / 块不残留）');
    const orb = await orbWithReply(
      'question-regression',
      '要打开哪个站？\n\n```xiangwo-question\n{"title":"要打开哪个站？","options":["日亚","美亚"],"allowCustom":true}\n```\n'
    );
    const doc = orb.window.document;
    const options = [...doc.querySelectorAll('.question-option')];
    check('提问卡渲染出来', doc.querySelectorAll('.question-card').length === 1);
    check('选项数 = 2', options.length === 2, `实际 ${String(options.length)}`);
    check(
      '气泡里没有 ```xiangwo-question 残留',
      bubbles(orb).every((t) => !t.includes('xiangwo-question')),
      JSON.stringify(bubbles(orb))
    );
    options[1].click();
    await waitFor(() => orb.state.requests.length >= 2);
    const body = String(orb.state.requests[1]?.body ?? '');
    check('点选项后把选项当成 user 消息发回去', body.includes('美亚'), body.slice(0, 200));
    orb.close();
  }

  // ---------- ⑧ 回归：权限档 ----------
  {
    console.log('\n⑧ 回归：权限档（切只读 → 下一条请求 system 前缀带 read-only）');
    const { html: h2, bundle: b2 } = readOrbBundle();
    const bridge = makeBridge();
    const orb = await openOrb({
      html: h2,
      bundle: b2,
      scenario: 'permission-regression',
      bridge,
      fetchImpl: async () => replyResponse('好的'),
    });
    const doc = orb.window.document;
    check('权限芯片默认显示「完全访问」', doc.querySelector('#permission-label')?.textContent === '完全访问');
    doc.querySelector('#permission-button').click();
    const readOnly = doc.querySelector('#permission-menu [data-preset="read-only"]');
    check('权限菜单有只读档', readOnly !== null);
    readOnly.click();
    check('切档后标签变「只读」', doc.querySelector('#permission-label')?.textContent === '只读');
    await sendMessage(orb, '帮我看看');
    await waitFor(() => orb.state.requests.length >= 1);
    const body = String(orb.state.requests[0]?.body ?? '');
    check(
      '请求 system 前缀带 XIANGWO_PERMISSION=read-only',
      body.includes('[XIANGWO_PERMISSION=read-only]'),
      body.slice(0, 160)
    );
    orb.close();
  }

  // ---------- ⑨ 回归：单击球展开 / 双击球打开主窗 ----------
  {
    console.log('\n⑨ 回归：单击球展开面板 / 双击球打开主窗');
    const { html: h3, bundle: b3 } = readOrbBundle();
    const bridge = makeBridge();
    const orb = await openOrb({
      html: h3,
      bundle: b3,
      scenario: 'ball-gesture-regression',
      bridge,
      fetchImpl: async () => replyResponse('好的'),
    });
    const ball = orb.window.document.querySelector('#ball');
    /** 只看 floating.setExpanded 调用（trace('ball-pointerup') 里也带 expanded 字段，不能按字段筛） */
    const expandedCalls = () =>
      orb.bridge.apiCalls
        .map((method, i) => [method, orb.bridge.apiArgs[i]])
        .filter(([method]) => method === 'floating.setExpanded')
        .map(([, args]) => args?.expanded);
    const click = () => {
      const opts = { button: 0, clientX: 10, clientY: 10, screenX: 10, screenY: 10, bubbles: true };
      ball.dispatchEvent(new orb.window.MouseEvent('pointerdown', opts));
      ball.dispatchEvent(new orb.window.MouseEvent('pointerup', opts));
      return sleep(60);
    };
    await click();
    check(
      '单击球 → 展开面板（floating.setExpanded(true)）',
      JSON.stringify(expandedCalls()) === JSON.stringify([true]),
      JSON.stringify(expandedCalls())
    );
    let openedMain = 0;
    bridge.orbOpenMain = async () => {
      openedMain += 1;
      return true;
    };
    await click();
    await click();
    await sleep(80);
    check('双击球 → 打开 emdash 主窗（orbOpenMain）', openedMain === 1, `实际 ${String(openedMain)}`);
    check(
      '双击撤销那下切换（expanded 序列 true,false,true）',
      JSON.stringify(expandedCalls()) === JSON.stringify([true, false, true]),
      JSON.stringify(expandedCalls())
    );
    orb.close();
  }
}

run()
  .then(() => {
    console.log(`\n[images-harness] 通过 ${String(passes.length)} 项，失败 ${String(failures.length)} 项`);
    if (failures.length > 0) {
      console.log('[images-harness] 失败项：');
      for (const item of failures) console.log(`  - ${item}`);
      process.exitCode = 1;
    }
  })
  .catch((error) => {
    console.error('[images-harness] 崩了：', error);
    process.exitCode = 1;
  });
