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
//   ① 含 xiangwo-images 的回复 → 渲染成图片网格（条数 / <img src> / lazy / no-referrer）
//   ② 点格子 → 调 host.openExternal(原图 url)
//   ③ 图片加载失败 → 占位（写着"图片加载失败" + 原链接），点它仍然开原图
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
    resolveXiangwoChatUrl: async () => ({ url: chatUrl, reachable: true, hint: '' }),
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
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
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
      },
      { url: 'https://img.example.com/b.jpg', alt: '烘焙刷 B', source: 'searxng' },
      { url: 'https://img.example.com/c.jpg', alt: '', source: 'zcool' },
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
    orb.close();
  }

  // ---------- ② 点图开原图 ----------
  {
    console.log('\n② 点格子 → host.openExternal(原图)');
    const orb = await orbWithReply('images-click', imagesBlock(samplePayload()));
    const cells = [...orb.window.document.querySelectorAll('.image-cell')];
    cells[1].click();
    const opened = orb.bridge.apiCalls.filter((m) => m === 'host.openExternal').length;
    const lastArgs = [...orb.bridge.apiArgs].reverse().find((a) => a?.url !== undefined);
    check('点击触发 host.openExternal', opened === 1, `实际 ${String(opened)}`);
    check(
      '开的是**原图** url（不是 thumb）',
      lastArgs?.url === 'https://img.example.com/b.jpg',
      String(lastArgs?.url)
    );
    check('格子 title 提示原图地址', cells[1].title === 'https://img.example.com/b.jpg');
    orb.close();
  }

  // ---------- ③ 加载失败 → 占位 ----------
  {
    console.log('\n③ 图片加载失败 → 先换原图重试，再显示占位 + 原链接（点它仍开原图）');
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
      '占位写着「图片加载失败」+ 原链接',
      fallback?.querySelector('.image-fallback-text')?.textContent === '图片加载失败' &&
        fallback?.querySelector('.image-fallback-url')?.textContent ===
          'https://img.example.com/a_full.jpg',
      JSON.stringify([
        fallback?.querySelector('.image-fallback-text')?.textContent,
        fallback?.querySelector('.image-fallback-url')?.textContent,
      ])
    );
    const cell = doc.querySelector('.image-cell.failed');
    cell.click();
    const lastArgs = [...orb.bridge.apiArgs].reverse().find((a) => a?.url !== undefined);
    check('失败格子仍能开原图', lastArgs?.url === 'https://img.example.com/a_full.jpg');
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
