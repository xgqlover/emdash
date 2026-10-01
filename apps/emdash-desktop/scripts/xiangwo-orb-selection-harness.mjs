#!/usr/bin/env node
// [XG-CUSTOM] 项我球 **划词工具条** harness —— 用 **Playwright + 真实 Chrome** 跑**构建产物**（out/renderer）。
//
// 前置：`pnpm run build:renderer`（产出 out/renderer/orb/orb.html + out/renderer/assets/orb-*.js）
// 用法：`node scripts/xiangwo-orb-selection-harness.mjs`（在 apps/emdash-desktop 下）
//       浏览器：默认用系统 /usr/bin/google-chrome（可用 XG_CHROME=/path/to/chrome 覆盖）。
//
// 为什么不用 jsdom（同目录另两个 harness 用 jsdom）：这个 bug 的病根是
// **"鼠标按下工具条时浏览器会折叠选区 → selectionchange → 工具条 hidden → mouseup/click 落空"**。
// jsdom 不实现"按下非可选元素即折叠选区/清除命中"的真实语义，只有真 Chrome + 真实 mouse
// 按下-抬起序列才能复现与回归，所以这里单独用 Playwright。
//
// 断言（① 是本次 bug 的核心回归断言）：
//   ① 按下工具条按钮期间，`#selection-bar` **没有被 hidden**；按下那一刻选区完好；
//      mouseup / click 的命中元素**仍然是那个按钮**（否则 click 必然落空 → "点了没反应"）
//      · 实测记录：修前 Chromium 里 click 本来就落得到按钮，真正"没反应"的是下面 ③⑤ 两条语义/静默问题；
//        这条断言防的是"按下即折叠选区 → 条被收掉 → 点击落空"这类真机/其它内核的退化。
//   ② 搜索 → 调 `host.openExternal`，URL = google 搜索 + encodeURIComponent(选中文本)
//   ③ 翻译 → **立即发出去**（选中文本进最后一条 user 消息 + 输入框被清空 + 转录里有提示词气泡）
//   ④ 发给项我 → 真的 send()（选中文本进最后一条 user 消息）
//   ⑤ 回答进行中点动作 → 必须有人话反馈（旧实现 `if (sending) return` 静默丢弃 = "点了没反应"）
//   ⑥ 用完即收；ESC / 点空白 / 清空选区 都能收起；键盘 Enter（click detail===0）也能触发
//   ⑦ 几何：工具条完整落在面板矩形内、三个按钮中心都能命中自己、贴在选区上方且水平居中
//      （正确定位很重要：真机球窗口是 X11 SHAPE 抠出来的，面板外的像素**点不到**）
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(HERE, '..', 'out', 'renderer');
const ORB_URL_PATH = '/orb/orb.html';

const SELECTED = '做划词回归测试';
const REPLY = `这是一段用来${SELECTED}的回答文字。`;
const SEARCH_PREFIX = 'https://www.google.com/search?q=';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

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

function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/** 静态服务器：把 out/renderer 挂在 http://127.0.0.1:<port>/（file:// 下 type=module 会被 CORS 拦） */
function serveRenderer() {
  const server = createServer((req, res) => {
    const raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (raw === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const target = resolve(join(RENDERER_DIR, raw));
    if (!target.startsWith(RENDERER_DIR) || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(readFileSync(target));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      done({ server, port: server.address().port });
    });
  });
}

function chromePath() {
  const override = process.env.XG_CHROME;
  if (typeof override === 'string' && override !== '') return override;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * 注入假桥 + 假 fetch + 事件探针（addInitScript：页面脚本跑之前就位）。
 * 注意：Playwright 会**序列化**参数，所以记录数组必须建在页面里（Node 侧的那份是拷贝），
 * 断言时统一用 readState() 从页面读回来。
 */
function installHarness(config) {
  window.__xg = {
    apiCalls: [],
    fetches: [],
    probe: [],
    reply: config.reply,
    hang: config.hang === true,
  };

  const defaultOrbApi = (method) => {
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
  };

  window.electronAPI = {
    resolveXiangwoChatUrl: async () => ({
      url: 'http://127.0.0.1:8900/v1/chat/completions',
      reachable: true,
      hint: '',
    }),
    orbApi: async (method, args) => {
      window.__xg.apiCalls.push({ method, args });
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

  // 普通 JSON 回复（非 SSE）—— 真 Response，走和真机一样的 response 处理路径
  // `hang: true` = 请求永远不回来（模拟"项我正在长时间流式回答"）
  window.fetch = async (url, init) => {
    window.__xg.fetches.push({ url: String(url), body: String(init?.body ?? '') });
    if (window.__xg.hang) return new Promise(() => {});
    const payload = JSON.stringify({ choices: [{ message: { content: window.__xg.reply } }] });
    return new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  // ---------- 事件探针：记录"按下 → 抬起"之间工具条/选区的真实状态 ----------
  const tag = (node) => {
    if (!(node instanceof Element)) return String(node);
    const action = node.dataset?.action;
    const base = node.id === '' ? node.tagName.toLowerCase() : `#${node.id}`;
    return action === undefined ? base : `${base}[data-action=${action}]`;
  };
  const barHidden = () => document.querySelector('#selection-bar')?.hidden ?? null;
  const selection = () => {
    const sel = getSelection();
    if (sel === null) return { text: '', collapsed: null };
    return { text: sel.toString(), collapsed: sel.isCollapsed };
  };
  for (const type of ['mousedown', 'mouseup', 'click']) {
    document.addEventListener(
      type,
      (event) => {
        const at = document.elementFromPoint(event.clientX, event.clientY);
        window.__xg.probe.push({
          at: type,
          target: tag(event.target),
          hit: tag(at),
          detail: event.detail,
          barHidden: barHidden(),
          ...selection(),
        });
      },
      true
    );
  }
  document.addEventListener(
    'selectionchange',
    () => {
      window.__xg.probe.push({ at: 'selectionchange', barHidden: barHidden(), ...selection() });
    },
    true
  );
}

const readState = (page) =>
  page.evaluate(() => ({
    apiCalls: window.__xg.apiCalls,
    fetches: window.__xg.fetches,
    probe: window.__xg.probe,
  }));

/**
 * 一次"按下-抬起"里，工具条是否始终没被 hidden、按下那一刻选区是否完好、抬起是否仍命中该按钮。
 * 注意：mouseup 时的 `collapsed` **不能**当断言 —— 动作在 mousedown 里跑完会重渲染转录区，
 * 选区随之作废是正常结果（旧实现只在 click 里做事，所以那会儿还没重渲染）。
 */
function pressIsClean(probe) {
  const from = probe.findLastIndex((entry) => entry.at === 'mousedown');
  if (from < 0) return { ok: false, why: 'probe 里没有 mousedown' };
  const downEntry = probe[from];
  const up = probe.findIndex((entry, index) => index > from && entry.at === 'mouseup');
  const during = up < 0 ? probe.slice(from + 1) : probe.slice(from + 1, up);
  const hiddenDuring = during.filter((entry) => entry.barHidden === true);
  const upEntry = up < 0 ? undefined : probe[up];
  const clickEntry = probe.find((entry, index) => index > from && entry.at === 'click');
  return {
    ok:
      downEntry.barHidden === false &&
      downEntry.collapsed === false &&
      hiddenDuring.length === 0 &&
      upEntry?.barHidden === false &&
      clickEntry !== undefined &&
      clickEntry.target === upEntry?.target,
    why: `按下时 barHidden=${String(downEntry.barHidden)} collapsed=${String(downEntry.collapsed)} / 按下期间被 hidden ${String(hiddenDuring.length)} 次 / mouseup barHidden=${String(upEntry?.barHidden)} collapsed=${String(upEntry?.collapsed)} hit=${String(upEntry?.hit)} click.target=${String(clickEntry?.target)}`,
    upEntry,
  };
}

/**
 * 在页面里把转录区某段文字**用真实鼠标拖选**出来，返回拖拽坐标。
 * - 取**最后**一个匹配（最新的那条气泡，通常在可视区里）；
 * - 先 scrollIntoView 再量坐标（同一条文字可能已被滚出转录区）；
 * - 拖之前清掉旧选区：mousedown 落在**已有选区内部**时 Chrome 是"拖动选区"而不是重新划选。
 */
async function dragSelect(page, needle) {
  await page.evaluate(() => getSelection().removeAllRanges());
  const rect = await page.evaluate((text) => {
    const transcript = document.querySelector('#transcript');
    const walker = document.createTreeWalker(transcript, NodeFilter.SHOW_TEXT);
    let target = null;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const index = node.textContent.indexOf(text);
      if (index >= 0) target = { node, index };
    }
    if (target === null) return null;
    const range = document.createRange();
    range.setStart(target.node, target.index);
    range.setEnd(target.node, target.index + text.length);
    target.node.parentElement.scrollIntoView({ block: 'center' });
    const box = range.getBoundingClientRect();
    const view = transcript.getBoundingClientRect();
    return {
      x1: box.left + 1,
      x2: box.right - 1,
      y: box.top + box.height / 2,
      view: { top: view.top, bottom: view.bottom },
    };
  }, needle);
  if (rect === null) throw new Error(`转录区里找不到要选的文字：${needle}`);
  if (rect.y < rect.view.top + 2 || rect.y > rect.view.bottom - 2) {
    throw new Error(`要选的文字不在转录区可视范围内：y=${String(rect.y)} view=${JSON.stringify(rect.view)}`);
  }
  await page.mouse.move(rect.x1, rect.y);
  await page.mouse.down();
  await page.mouse.move((rect.x1 + rect.x2) / 2, rect.y, { steps: 4 });
  await page.mouse.move(rect.x2, rect.y, { steps: 4 });
  await page.mouse.up();
  await sleep(60);
  const got = await page.evaluate(() => getSelection().toString());
  if (got !== needle) throw new Error(`拖选结果不是期望文字：${JSON.stringify(got)}（期望 ${needle}）`);
  return rect;
}


const barVisible = (page) =>
  page.evaluate(() => document.querySelector('#selection-bar').hidden === false);
const barSelection = (page) =>
  page.evaluate(() => document.querySelector('#selection-bar').dataset.selection ?? '');
const userBubbles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.transcript-row.user .transcript-bubble')].map(
      (el) => el.textContent
    )
  );
const promptText = (page) => page.evaluate(() => document.querySelector('#prompt').innerText ?? '');
const statusText = (page) =>
  page.evaluate(() => document.querySelector('#status').textContent ?? '');

/** 工具条 / 面板 / 选区的几何事实（视口坐标） */
const barGeometry = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const bar = document.querySelector('#selection-bar');
    const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : null;
    return {
      bar: box(bar),
      panel: box(document.querySelector('#panel')),
      selection: range === null ? null : box(range),
    };
  });

/** 每个按钮中心的命中测试结果（防"被别的元素盖住 / 画到了面板外"） */
const buttonHits = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#selection-bar button')].map((button) => {
      const rect = button.getBoundingClientRect();
      const at = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return { action: button.dataset.action, hit: at?.dataset?.action ?? at?.id ?? 'none' };
    })
  );

/** 最后一条 user 消息的文本（发出去的 body 里） */
function lastUserContent(fetches) {
  const last = fetches.at(-1);
  if (last === undefined) return '';
  const body = JSON.parse(last.body);
  const messages = body.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  if (lastUser === undefined) return '';
  const content = lastUser.content;
  if (typeof content === 'string') return content;
  return (content ?? []).map((part) => part.text ?? '').join('');
}

/** 点工具条上某个动作按钮：真实 mousedown → mouseup → click，然后读回页面状态 */
async function pressAction(page, action) {
  const before = (await readState(page)).probe.length;
  await page.locator(`#selection-bar button[data-action="${action}"]`).click();
  await sleep(160);
  const state = await readState(page);
  const slice = state.probe.slice(before);
  return { state, slice, press: pressIsClean(slice) };
}

/** 打开一个球面板页面（真产物 + 假桥 + 探针） */
async function openPage(browser, port, config) {
  const page = await browser.newPage({ viewport: { width: 420, height: 720 } });
  const errors = [];
  page.on('pageerror', (cause) => errors.push(String(cause)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(installHarness, config);
  await page.goto(`http://127.0.0.1:${String(port)}${ORB_URL_PATH}`);
  await page.waitForFunction(() => document.querySelectorAll('#bot option').length > 1);
  return { page, errors };
}

async function run() {
  if (!existsSync(join(RENDERER_DIR, 'orb', 'orb.html'))) {
    throw new Error(
      `找不到构建产物 ${join(RENDERER_DIR, 'orb', 'orb.html')}，先跑 pnpm run build:renderer`
    );
  }
  const { server, port } = await serveRenderer();
  const executablePath = chromePath();
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
  const { page, errors } = await openPage(browser, port, { reply: REPLY });

  // ---------- 打开面板 + 造一段可划词的回复 ----------
  console.log('\n① 打开面板（真实点球）→ 发一条消息拿到可划词的回复');
  await page.click('#ball');
  await page.waitForFunction(() => document.body.classList.contains('expanded'));
  await page.click('#prompt');
  await page.keyboard.type('划词');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll('.transcript-bubble')].some((el) => el.textContent === text),
    REPLY
  );
  check('转录区出现可划词的回答', (await page.evaluate(() => document.body.innerText)).includes(SELECTED));

  // ---------- 划词 → 工具条出现 ----------
  console.log('\n② 真实鼠标拖选 → 划词工具条弹出');
  await dragSelect(page, SELECTED);
  check('选中后工具条弹出（未 hidden）', await barVisible(page));
  check(
    '工具条记着选中文本',
    (await barSelection(page)) === SELECTED,
    JSON.stringify(await barSelection(page))
  );
  const hitAtButton = await page.evaluate(() => {
    const button = document.querySelector('#selection-bar button[data-action="translate"]');
    const box = button.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return at?.dataset?.action ?? at?.id ?? at?.tagName ?? 'null';
  });
  check('按钮中心命中测试 = 该按钮（没有被别的元素盖住）', hitAtButton === 'translate', hitAtButton);
  {
    const hits = await buttonHits(page);
    check(
      '三个按钮中心命中测试都命中自己',
      hits.every((entry) => entry.hit === entry.action),
      JSON.stringify(hits)
    );
    const geometry = await barGeometry(page);
    const { bar, panel, selection } = geometry;
    check(
      '工具条完整落在面板矩形内（真机上 SHAPE 之外的像素点不到）',
      bar.left >= panel.left && bar.top >= panel.top && bar.right <= panel.right && bar.bottom <= panel.bottom,
      JSON.stringify({ bar, panel })
    );
    check(
      '工具条贴在选区上方 + 水平居中（不再整体偏一个 --chrome=12px）',
      selection !== null &&
        bar.bottom <= selection.top &&
        Math.abs((bar.left + bar.right) / 2 - (selection.left + selection.right) / 2) <= 3,
      JSON.stringify({ bar, selection })
    );
  }
  // 靠左边缘的选区（旧算法会把条夹到面板外的透明/SHAPE 边距里 → 被裁 + 点不到）
  {
    await dragSelect(page, REPLY.slice(0, 4));
    const { bar, panel } = await barGeometry(page);
    check(
      '选区贴左边缘时，工具条仍完整落在面板内（旧算法 left=8 < panel.left=12 → 出面板）',
      bar.left >= panel.left && bar.right <= panel.right,
      JSON.stringify({ bar, panel })
    );
    await dragSelect(page, SELECTED); // 还原成后面断言用的选区
  }

  // ---------- ③ 核心回归：按下期间工具条不能被 hidden ----------
  console.log('\n③ [核心回归] 按下"翻译"：按下期间工具条不被 hidden、选区不被折叠、抬起仍命中按钮');
  {
    const { press } = await pressAction(page, 'translate');
    check('按下期间工具条没有被 hidden / 选区没有被折叠 / 抬起仍命中按钮', press.ok, press.why);
    check(
      'mouseup 的命中元素是 translate 按钮',
      press.upEntry?.hit?.includes('translate') === true,
      JSON.stringify(press.upEntry?.hit)
    );
  }

  // ---------- ④ 三个动作逐个验（每个都有可观测结果） ----------
  console.log('\n④ 三个动作逐个验（可观测结果）');
  // 翻译：立即发送
  {
    await dragSelect(page, SELECTED);
    const before = await readState(page);
    const { state, press } = await pressAction(page, 'translate');
    const sent = lastUserContent(state.fetches);
    check(
      '翻译：发生了一次新的 fetch（真的发出去）',
      state.fetches.length === before.fetches.length + 1,
      `实际 +${String(state.fetches.length - before.fetches.length)}`
    );
    check(
      '翻译：提示词进最后一条 user 消息（含选中文本）',
      sent.includes('把下面这段翻译成中文') && sent.includes(SELECTED),
      JSON.stringify(sent)
    );
    check(
      '翻译：转录区出现提示词气泡（用户马上看得见）',
      (await userBubbles(page)).includes(`把下面这段翻译成中文：\n${SELECTED}`),
      JSON.stringify(await userBubbles(page))
    );
    check('翻译：输入框被清空（不是"只填进输入框等人回车"）', (await promptText(page)).trim() === '');
    check(
      '翻译：没有误调 host.openExternal',
      state.apiCalls.filter((call) => call.method === 'host.openExternal').length ===
        before.apiCalls.filter((call) => call.method === 'host.openExternal').length,
      JSON.stringify(state.apiCalls.slice(before.apiCalls.length).map((call) => call.method))
    );
    check('翻译：用完工具条收起', (await barVisible(page)) === false);
    check('翻译：按下期间工具条没有被 hidden', press.ok, press.why);
  }
  // 搜索：host.openExternal
  {
    await dragSelect(page, SELECTED);
    const before = await readState(page);
    const { state, press } = await pressAction(page, 'search');
    const opened = state.apiCalls.filter((call) => call.method === 'host.openExternal');
    check('搜索：调了 host.openExternal', opened.length === 1, JSON.stringify(opened));
    check(
      '搜索：URL = google 搜索 + encodeURIComponent(选中文本)',
      opened[0]?.args?.url === SEARCH_PREFIX + encodeURIComponent(SELECTED),
      JSON.stringify(opened[0]?.args?.url)
    );
    check(
      '搜索：没有误发消息',
      state.fetches.length === before.fetches.length,
      `实际 +${String(state.fetches.length - before.fetches.length)}`
    );
    check('搜索：用完工具条收起', (await barVisible(page)) === false);
    check('搜索：按下期间工具条没有被 hidden', press.ok, press.why);
  }
  // 发给项我
  {
    await dragSelect(page, SELECTED);
    const before = await readState(page);
    const { state, press } = await pressAction(page, 'send');
    const sent = lastUserContent(state.fetches);
    check(
      '发给项我：发生了一次新的 fetch',
      state.fetches.length === before.fetches.length + 1,
      `实际 +${String(state.fetches.length - before.fetches.length)}`
    );
    check('发给项我：选中文本进最后一条 user 消息', sent.includes(SELECTED), JSON.stringify(sent));
    check('发给项我：选中文本作为用户气泡出现在转录区', (await userBubbles(page)).includes(SELECTED));
    check('发给项我：用完工具条收起', (await barVisible(page)) === false);
    check('发给项我：按下期间工具条没有被 hidden', press.ok, press.why);
  }

  // ---------- ⑤ 收起路径：ESC / 点空白 / 清选区 ----------
  console.log('\n⑤ 收起路径：ESC / 点空白 / 清空选区');
  await dragSelect(page, SELECTED);
  check('（前置）重新划词后工具条弹出', await barVisible(page));
  await page.keyboard.press('Escape');
  await sleep(60);
  check('ESC → 工具条收起', (await barVisible(page)) === false);

  await dragSelect(page, SELECTED);
  await page.mouse.click(6, 6); // 面板外的窗口空白（面板 inset 12px）
  await sleep(80);
  check('点空白 → 工具条收起', (await barVisible(page)) === false);

  await dragSelect(page, SELECTED);
  await page.evaluate(() => getSelection().removeAllRanges());
  await sleep(80);
  check('清空选区 → 工具条收起', (await barVisible(page)) === false);

  // ---------- ⑥ 键盘激活（detail === 0）也要能触发 ----------
  console.log('\n⑥ 键盘 Enter 激活（click detail===0）也要能触发动作');
  {
    await dragSelect(page, SELECTED);
    const before = await readState(page);
    await page.locator('#selection-bar button[data-action="send"]').focus();
    await page.keyboard.press('Enter');
    await sleep(200);
    const after = await readState(page);
    check(
      '键盘 Enter：动作被触发（发出去一条）',
      after.fetches.length === before.fetches.length + 1,
      `实际 +${String(after.fetches.length - before.fetches.length)}`
    );
    check('键盘 Enter：用完工具条收起', (await barVisible(page)) === false);
  }

  check('页面无 JS 报错', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---------- ⑦ 正在流式回答时点动作 → 必须有反馈（旧实现静默丢弃 = "点了没反应"） ----------
  console.log('\n⑦ 回答进行中点"发给项我"：不能静默无反应（旧实现 send 的 `if (sending) return` 会丢弃）');
  {
    const busy = await openPage(browser, port, { reply: REPLY, hang: true });
    await busy.page.click('#ball');
    await busy.page.waitForFunction(() => document.body.classList.contains('expanded'));
    await busy.page.click('#prompt');
    await busy.page.keyboard.type('第一批文字');
    await busy.page.keyboard.press('Enter');
    await busy.page.waitForFunction(() => window.__xg.fetches.length === 1);
    await dragSelect(busy.page, '第一批文字');
    check('（前置）回答进行中划词，工具条照常弹出', await barVisible(busy.page));
    const before = await readState(busy.page);
    await busy.page.locator('#selection-bar button[data-action="send"]').click();
    await sleep(200);
    const after = await readState(busy.page);
    check(
      '回答进行中：没有真的再发一条（send 会丢弃，符合预期）',
      after.fetches.length === before.fetches.length,
      `实际 +${String(after.fetches.length - before.fetches.length)}`
    );
    check(
      '回答进行中：给出了人话反馈（不是静默无反应）',
      (await statusText(busy.page)).includes('正在回答'),
      JSON.stringify(await statusText(busy.page))
    );
    check('回答进行中：工具条收起', (await barVisible(busy.page)) === false);
    check('回答进行中场景无 JS 报错', busy.errors.length === 0, busy.errors.slice(0, 2).join(' | '));
    await busy.page.close();
  }

  await browser.close();
  server.close();

  console.log(`\n[harness] 通过 ${String(passes.length)} 项，失败 ${String(failures.length)} 项`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
  }
}

await run();
