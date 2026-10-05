#!/usr/bin/env node
// [XG-CUSTOM 2026-10-05] 项我球**提问卡** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`（产出 out/renderer/orb/orb.html + assets/orb-*.js）
// 用法：`node scripts/xiangwo-orb-question-harness.mjs`（在 apps/emdash-desktop 下）
//
// 为什么有它：提问卡是全项目**唯一没有测试**的卡片（chat/history/images 都各有 harness），
// 而 2026-10-05 往它上面加了三个语义（`maxSelections` / `defaultValue` / 记住上次选择）——
// 没网就等着回归。手法沿用 chat harness：jsdom 载入产物 html + 假桥 + 假 SSE，只断言外部可见事实。
//
// 断言：
//   ① 卡片渲染（一问、4 个选项）
//   ② `defaultValue` 预选生效（chosen + aria-checked）
//   ③ `defaultValue` 里**不存在**的 label 被丢弃（不产生幽灵已选项）
//   ④ `maxSelections`：到顶后再点被**忽略** + 出「最多选 N 项」（不静默吞点击）
//   ⑤ 取消一个后能再选（上限是可恢复的，不是死锁）
//   ⑥ 提交 → 答案文本作为 user 消息发回（含所选两项）
//   ⑦ 提交后写入 localStorage `xg-question-memory`
//   ⑧ 第二张卡（同 id、无 defaultValue）→ 自动预选上次的选择（记忆生效）
//   ⑨ 第二张卡不预选"上次没选的"（记忆不是无脑全选）
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

function defineGlobal(key, value) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch {
    /* 写不进去就算了 */
  }
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

/** 假的 OpenAI 兼容 SSE：一次把整段推完 + [DONE] */
function sseOnce(text) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`
        )
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

async function openOrb({ html, bundle, replies }) {
  const dom = new JSDOM(html.replace(SCRIPT_TAG, ''), {
    url: 'http://localhost/orb/orb.html',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });
  const { window } = dom;
  const state = { sent: [], replyIndex: 0 };

  window.electronAPI = makeBridge();
  defineGlobal('window', window);
  defineGlobal('document', window.document);
  defineGlobal('location', window.location);
  defineGlobal('localStorage', window.localStorage);
  defineGlobal('sessionStorage', window.sessionStorage);
  defineGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  defineGlobal('requestAnimationFrame', (cb) => window.setTimeout(() => cb(Date.now()), 16));
  defineGlobal('cancelAnimationFrame', (id) => window.clearTimeout(id));
  defineGlobal('fetch', async (url, init) => {
    state.sent.push(String(init?.body ?? ''));
    const text = replies[Math.min(state.replyIndex, replies.length - 1)];
    state.replyIndex += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseOnce(text),
      text: async () => text,
    };
  });
  for (const key of GLOBAL_KEYS) {
    const value = window[key];
    if (value !== undefined) defineGlobal(key, value);
  }
  window.document.execCommand = () => false;

  const bundleUrl = `${pathToFileURL(bundle).href}?q=${String(importCounter)}`;
  importCounter += 1;
  await import(bundleUrl);
  return { window, state, close: () => dom.window.close() };
}

/** 打开球面板 → 发一条消息（等输入框就绪） */
async function sendMessage(orb, text) {
  const { window } = orb;
  await waitFor(() => window.document.querySelectorAll('#bot option').length > 1);
  await sleep(50);
  const prompt = window.document.querySelector('#prompt');
  prompt.textContent = text;
  prompt.dispatchEvent(new window.Event('input', { bubbles: true }));
  const form = window.document.querySelector('#composer');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

/** 最后一张提问卡：第一张提交后会变成"已答态"但 DOM 仍在 → 断言必须限定在最后一张上 */
function lastCard(window) {
  const cards = [...window.document.querySelectorAll('.question-card')];
  return cards[cards.length - 1] ?? null;
}

function options(window) {
  const card = lastCard(window);
  if (card === null) return [];
  return [...card.querySelectorAll('.question-option')].map((button) => ({
    label: button.querySelector('.question-option-label')?.textContent ?? '',
    chosen: button.classList.contains('chosen'),
    ariaChecked: button.getAttribute('aria-checked'),
    button,
  }));
}

function chosenLabels(window) {
  return options(window)
    .filter((option) => option.chosen)
    .map((option) => option.label);
}

function errorText(window) {
  return lastCard(window)?.querySelector('.question-error')?.textContent ?? '';
}

function cardQuestion(id, extra = {}) {
  const spec = {
    id,
    header: '风格',
    question: '选哪几个风格？',
    multiSelect: true,
    maxSelections: 2,
    options: ['国潮', '波普', '极简留白', '赛博朋克'],
    ...extra,
  };
  return `\`\`\`xiangwo-question\n${JSON.stringify({
    questions: [spec],
    allowCustom: false,
  })}\n\`\`\``;
}

async function main() {
  const { html, bundle } = readOrbBundle();
  console.log('项我球 · 提问卡 harness（跑产物 out/renderer）\n');

  // ── 场景 1：新语义（defaultValue / 脏数据过滤 / maxSelections / 提交 / 记忆写入）──
  console.log('① 新语义：defaultValue 预选 + maxSelections 上限 + 提交记忆');
  {
    const reply1 = cardQuestion('style-pick', {
      defaultValue: ['国潮', '波普', '不存在的风格'],
    });
    const reply2 = cardQuestion('style-pick'); // 同 id、无 defaultValue → 走记忆
    const orb = await openOrb({ html, bundle, replies: [reply1, reply2] });
    const { window, state } = orb;

    await sendMessage(orb, '帮我挑风格');
    await waitFor(() => window.document.querySelector('.question-card') !== null);

    const first = options(window);
    check('① 卡片渲染出 1 问 4 选项', first.length === 4, `实际 ${String(first.length)} 个选项`);
    check(
      '② defaultValue 预选生效（国潮/波普 chosen + aria-checked）',
      chosenLabels(window).join('、') === '国潮、波普' &&
        first.filter((o) => o.ariaChecked === 'true').length === 2,
      `chosen=${chosenLabels(window).join('、')}`
    );
    check(
      '③ defaultValue 里不存在的 label 被丢弃（没有幽灵已选项）',
      chosenLabels(window).length === 2 && !chosenLabels(window).includes('不存在的风格')
    );

    // 到顶后再点第三个 → 应被忽略 + 提示
    const third = options(window).find((o) => o.label === '极简留白');
    third.button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    check(
      '④ maxSelections：到顶后新增被忽略 + 出「最多选 2 项」',
      chosenLabels(window).length === 2 && errorText(window).includes('最多选 2 项'),
      `chosen=${chosenLabels(window).join('、')} error="${errorText(window)}"`
    );

    // 取消一个 → 再选刚才那个 → 应成功
    options(window)
      .find((o) => o.label === '国潮')
      .button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(20);
    options(window)
      .find((o) => o.label === '极简留白')
      .button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep(20);
    check(
      '⑤ 取消一个后能再选（上限不是死锁）且错误提示被清',
      chosenLabels(window).join('、') === '波普、极简留白' && errorText(window) === '',
      `chosen=${chosenLabels(window).join('、')} error="${errorText(window)}"`
    );

    // 提交
    window.document
      .querySelector('.question-submit')
      ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await waitFor(() => state.sent.length >= 1);
    await sleep(60);
    const sentBody = state.sent[state.sent.length - 1] ?? '';
    check(
      '⑥ 提交 → 答案文本作为 user 消息发回（含所选两项）',
      sentBody.includes('波普') && sentBody.includes('极简留白'),
      sentBody.slice(-160)
    );
    const memory = JSON.parse(window.localStorage.getItem('xg-question-memory') ?? '{}');
    check(
      '⑦ 提交后写入 localStorage xg-question-memory（按问题 id）',
      JSON.stringify(memory['style-pick']) === JSON.stringify(['波普', '极简留白']),
      JSON.stringify(memory)
    );

    // ── 场景 2：记忆生效（同 id、无 defaultValue）──
    await sendMessage(orb, '再挑一次');
    await waitFor(
      () =>
        window.document.querySelectorAll('.question-card').length >= 2 &&
        options(window).length === 4
    );
    await sleep(60);
    check(
      '⑧ 第二张卡（同 id、无 defaultValue）自动预选上次的选择',
      chosenLabels(window).join('、') === '波普、极简留白',
      `chosen=${chosenLabels(window).join('、')}`
    );
    check('⑨ 记忆不是无脑全选（上次没选的仍不选）', !chosenLabels(window).includes('国潮'));
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
