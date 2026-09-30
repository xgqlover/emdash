// [XG-CUSTOM] 项我控制球面板 —— 移植自开源项目 mini-yifan/deepseek-harness-orb（MIT）
// 源文件：apps/desktop/renderer/floating.js（球 + 面板 + 聊天 UI）。
//
// 相对上游的改造（按需精简 dsh 强耦合部分）：
//   1) 后端调用：上游 `rpc(method, args)` → fetch('dsh-app://app/api/<method>') 的 envelope 协议，
//      这里换成 `window.electronAPI.orbApi(method, args)`（preload → ipcMain 'xiangwo:orb-api'，
//      路由在 main/host/xiangwo-orb-api.ts）。
//   2) 聊天通道：上游走 dsh 的 `.dsh/remote-stream` 事件流 + session/create|prompt|list，
//      这里换成我们现成的 OpenAI 格式直答：POST http://127.0.0.1:8900/v1/chat/completions
//      （照 renderer/XiangwoFloatingPanel.tsx 的 body 结构），回复直接渲染成消息气泡。
//      [XG-CUSTOM] 地址不再写死：由主进程解析、preload 暴露（`resolveXiangwoChatUrl()`），
//      渲染进程不猜主机 —— 远程主机（Windows 客户端连 Linux 主机）时才是对的地址；
//      解析不到就回落 127.0.0.1。失败自动重试见 ./xiangwo-chat.ts（盖住 8900 重启空窗）。
//   3) 删掉：iframe 转录（dsh-app://app/index.html?surface=overlay）、OVERLAY_SESSION_MESSAGE_TYPE
//      postMessage 协议、user-questions 事件流 / 提问卡、TCC（macOS 授权）门、选区芯片、
//      模型目录（session/selectModel）、macOS 停靠条的 JS（DOM/CSS 留着，停靠是 TODO）。
//   4) 新增：📷 截图（captureCurrentTab）、📤 交接（taskSpaceList/Handoff）、bot 选择、
//      本地历史（localStorage）、#stop 用 AbortController 真的能中断请求。
//   6) [XG-CUSTOM] **提问卡协议**（补上游被删掉的 `#question`/`.question-card`）：
//      我们的 8900 通道是 OpenAI 兼容纯文本，没有结构化提问消息，所以约定一个 fenced JSON 块。
//      agent 只要在回复里带上（单独成段）：
//        ```xiangwo-question
//        {"title":"要打开哪个站？","options":["日亚","美亚","其他"],"allowCustom":true}
//        ```
//      渲染进程就把它渲染成一张选项卡（标题 + 选项按钮 + 可自定义输入），
//      用户点选/输入后**作为一条 user 消息发回去**（卡片变灰不可再点）。
//      字段：title 必填；options 选填（≤12 个，每个 ≤120 字）；allowCustom 选填（默认 true）。
//      解析失败就整段当普通文本渲染（绝不吞消息）。
//   7) [XG-CUSTOM] **划词工具条（范围内版）**：只在球面板内部选中文字时弹出
//      「搜索 / 翻译 / 发给项我」。全局版（任意应用选中 → 快捷键唤起）见文件末尾 TODO
//      （Linux 需要 xdotool/xclip + 全局快捷键，属系统级依赖，先不做）。
//   8) [XG-CUSTOM] 明确**不做**（写明原因，避免以后当成漏做）：
//      - 上游的 `dsh-app://` 自定义协议 / iframe 嵌 dsh 转录 → 我们直接用 8900 直连 + 自己渲染气泡；
//      - 上游 `backend.subscribe` 流式 → 我们 8900 是非流式（一次返回），不需要；
//      - 上游的选区芯片 / macOS TCC 授权门 → macOS/Win 专属，Linux 无此概念（主进程侧保持 no-op）。
//   5) 交互模型（用户实测后定的）：
//      - **单击球 = 切换开/关**（收起态 → 打开并保持；展开态 → 收起，等价于点面板右上 ✕）
//      - **双击球 = 打开 emdash 主窗口**（400ms 窗口；第二次零位移单击 → 撤销第一次那下切换 + orbOpenMain，
//        净效果面板状态不变；单击本身不延迟，所以不卡手）
//      - **右键球 = 原生菜单**（打开主窗口 / 打开收起面板 / 退出项我球，见
//        main/host/xiangwo-orb-api.ts 的 popupOrbContextMenu）
//      - hover 只给视觉反馈、不展开；拖动是**自绘指针拖动**（原生 -webkit-app-region: drag 会吞掉 click，
//        导致"点不开面板"，所以不用它）。**两种状态下球都可拖**：收起态移动球、展开态平移整个面板
//      - 历史**按 bot 分桶**（见文件里的 STORE_KEY_PREFIX / botStoreKey）
//
// [XG-CUSTOM] 聊天通道工具（地址解析 + 失败重试）在 ./xiangwo-chat.ts 里 —— 球和旧浮窗共用一份，
// 并且能被 vitest 直接单测；构建后会被打进本 bundle（harness 断言跑的就是产物）。
import {
  failureText,
  replyTextOf,
  resolveXiangwoChatUrl,
  retryStatusText,
  sendXiangwoChat,
} from './xiangwo-chat';

const bridge = window.electronAPI ?? {};

/** 位移超过这个 DIP 数才开始"跟手拖动"（响应性阈值） */
const DRAG_THRESHOLD_PX = 4;
/**
 * [XG-CUSTOM] 单击/拖动的**判定**阈值（DIP）：真实鼠标"单击"的手抖经常 > 4 DIP，
 * 只看过程里的 dragging 会把单击误判成拖动 → 把开关吞掉（真机「展开态点球没反应」）。
 * 所以：总位移 ≤ CLICK_MAX_PX 一律算单击（并把漂出去的几像素挪回按下前的位置）；
 * 超过才算真拖动。4 = 开始跟手、8 = 还算单击，两个阈值各管一件事。
 */
const CLICK_MAX_PX = 8;
/**
 * [XG-CUSTOM] 双击窗口（ms）：这个窗口内的第二次**零位移单击**判为双击 → 打开 emdash 主窗口，
 * 并撤销第一次那下切换（净效果：面板状态跟双击前一致）。
 * 第一次单击**立即**执行、不做延迟，所以单击零延迟、不卡手。
 */
const DOUBLE_CLICK_GUARD_MS = 400;
/**
 * [XG-CUSTOM] 系统前缀。除了路由/来源，还带上**权限档**（D-1：让权限芯片真的生效）。
 * 说明：8900 后端目前**不解析**该字段（它只认 messages 里的 text），所以我们只保证"发出去"，
 * 待后端支持后即可用它做工具白名单；后端一旦支持无需改渲染进程。
 */
const SYSTEM_PREFIX = '[XIANGWO_ROUTE=R0][XIANGWO_SOURCE=sidebar]';
/** 权限档也进 system 前缀（见 SYSTEM_PREFIX 注释） */
function systemPrefixFor(permission) {
  return `${SYSTEM_PREFIX}[XIANGWO_PERMISSION=${permission}]`;
}
const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access'];
const PERMISSION_LABELS = {
  'read-only': '只读',
  'workspace-write': '工作区写入',
  'danger-full-access': '完全访问',
};
// [XG-CUSTOM] 与 XiangwoFloatingPanel 相同的 bot 列表（发消息时加 '@<id> ' 前缀）
const BOT_OPTIONS = [
  { id: '', name: '项我' },
  { id: 'sxsj', name: '尚享设计' },
  { id: 'babado', name: 'Babado' },
  { id: 'dayi', name: '大翼' },
  { id: 'shangcha', name: '上茶' },
  { id: 'shuobo', name: '硕博' },
  { id: 'yunyou', name: '云悠' },
  { id: 'chief-engineer', name: '总工' },
  { id: 'ceo', name: 'CEO' },
  { id: 'caiwuzongguan', name: '财务' },
];

const COMPOSER_MIN_PX = 72;
const COMPOSER_LINE_PX = 20;
const COMPOSER_EXTRA_LINES = 3;
const COMPOSER_MAX_PX = COMPOSER_MIN_PX + COMPOSER_LINE_PX * COMPOSER_EXTRA_LINES;

/**
 * 适配层：把上游 `api.floating.*` / `api.backend.*` 映射到我们的 orbApi(method, args)。
 * 方法名与参数语义照上游调用点，方便以后对着 floating.js 对齐升级。
 */
const api = {
  floating: {
    setExpanded: (expanded) => orbApi('floating.setExpanded', { expanded }),
    move: (x, y, canDock) => orbApi('floating.move', { x, y, canDock }),
    clamp: (canDock) => orbApi('floating.clamp', { canDock }),
    unsnap: () => orbApi('floating.unsnap', {}),
    sessionId: () => orbApi('floating.sessionId', {}),
    setSessionId: (id) => orbApi('floating.setSessionId', { id }),
    setSessionRunning: (running) => orbApi('floating.setSessionRunning', { running }),
    overlayPermission: () => orbApi('floating.overlayPermission', {}),
    setOverlayPermission: (preset, sessionId) =>
      orbApi('floating.setOverlayPermission', { preset, sessionId }),
    overlayModel: () => orbApi('floating.overlayModel', {}),
    avatarUrl: () => orbApi('floating.avatarUrl', {}),
    orbWorkspacePath: () => orbApi('floating.orbWorkspacePath', {}),
    relaunch: () => orbApi('floating.relaunch', {}),
    tccStatus: () => orbApi('floating.tccStatus', {}),
    openTcc: (right) => orbApi('floating.openTcc', { right }),
    // [XG-CUSTOM] 右键菜单：主进程弹原生菜单，返回被点中的动作（'open-main'|'toggle-panel'|'quit'|null）
    contextMenu: () => orbApi('floating.contextMenu', {}),
    onCreateSession: () => orbApi('floating.onCreateSession', {}),
    // 订阅类：我们不做选区工具条，返回空订阅（保持与上游同样的调用形状）。
    onSelectionPrompt: () => () => {},
    onSelectionAttach: () => () => {},
  },
  backend: {
    subscribe: () => orbApi('backend.subscribe', {}),
    status: () => orbApi('backend.status', {}),
  },
};

/**
 * 调宿主（主进程）。
 * @param {string} method floating.* / backend.* 方法名
 * @param {object} args 方法参数
 * @returns {Promise<unknown>} 方法结果
 */
async function orbApi(method, args = {}) {
  if (typeof bridge.orbApi !== 'function') throw new Error('orbApi 桥接不可用');
  return bridge.orbApi(method, args);
}

function describeError(cause) {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * [XG-CUSTOM][TEMP-TRACE] 把渲染进程的关键交互事实发给主进程写进日志
 * （路由见 main/host/xiangwo-orb-api.ts 的 'debug.trace'；主进程侧 XIANGWO_ORB_TRACE=0 可关）。
 * 真机「展开态点球没反应」排查用；定位完连同主进程的 orbTrace 一起删。
 * @param {string} event 事件名
 * @param {object} detail 细节
 */
function trace(event, detail = {}) {
  try {
    void bridge.orbApi?.('debug.trace', { event, ...detail });
  } catch {
    /* 排查用，绝不能因为日志把交互搞坏 */
  }
}

/** [XG-CUSTOM][TEMP-TRACE] 球/命中/状态的快照（放 trace 里当上下文） */
function ballDebug() {
  const ball = document.querySelector('#ball');
  const panel = document.querySelector('#panel');
  const rect = ball.getBoundingClientRect();
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  const style = getComputedStyle(ball);
  const mark = document.querySelector('#ball-mark');
  return {
    body: document.body.className,
    panelHidden: panel === null ? null : panel.hidden,
    panelRect:
      panel === null
        ? null
        : [Math.round(panel.getBoundingClientRect().width), Math.round(panel.getBoundingClientRect().height)],
    ball: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
    ballPointerEvents: style.pointerEvents,
    // [XG-CUSTOM] TEMP-TRACE：这几项是"球到底画没画"的直接证据
    ballDisplay: style.display,
    ballVisibility: style.visibility,
    ballOpacity: style.opacity,
    ballBackground: style.backgroundColor,
    ballRadius: style.borderRadius,
    markColor: mark === null ? null : getComputedStyle(mark).color,
    promptRect: (() => {
      const el = document.querySelector('#prompt');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    })(),
    composerRect: (() => {
      const el = document.querySelector('#composer');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    })(),
    cssBall: getComputedStyle(document.documentElement).getPropertyValue('--ball').trim(),
    cssComposerHeight: getComputedStyle(document.body).getPropertyValue('--composer-height').trim(),
    hitAtBallCenter: hit === null ? null : `${hit.tagName}#${hit.id}`,
    viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
  };
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `orb-${String(Date.now())}-${Math.random().toString(16).slice(2)}`;
}

/**
 * [XG-CUSTOM] 解析回复里的提问块（协议见文件头 6)）。
 * 找不到/JSON 坏了 → 原样返回文本、question = undefined（绝不吞消息）。
 * @param {string} text 助手回复原文
 * @returns {{ text: string, question?: { title: string, options: string[], allowCustom: boolean } }}
 */
function parseQuestionBlock(text) {
  const match = /```xiangwo-question\s*([\s\S]*?)```/.exec(text);
  if (match === null) return { text };
  try {
    const raw = JSON.parse(match[1].trim());
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    if (title === '') return { text };
    const options = Array.isArray(raw.options)
      ? raw.options
          .filter((o) => typeof o === 'string' && o.trim() !== '')
          .slice(0, 12)
          .map((o) => o.trim().slice(0, 120))
      : [];
    const allowCustom = raw.allowCustom !== false;
    const cleaned = text.replace(match[0], '').trim();
    return { text: cleaned, question: { title: title.slice(0, 200), options, allowCustom } };
  } catch {
    return { text };
  }
}

function promptText(prompt) {
  const raw = prompt.innerText ?? prompt.textContent ?? '';
  return raw.replaceAll('\u00a0', ' ');
}

function insertPlainText(prompt, text) {
  if (text === '') return;
  if (
    typeof document.execCommand === 'function' &&
    document.execCommand('insertText', false, text)
  ) {
    return;
  }
  prompt.append(text);
}

function isComposing(event) {
  return event.isComposing === true || event.keyCode === 229;
}

function permissionText(preset) {
  return PERMISSION_LABELS[preset] ?? PERMISSION_LABELS['danger-full-access'];
}

/**
 * [XG-CUSTOM] 历史按 **bot 分桶**（用户要求：选 Babado / sxsj 不能看到同一份混在一起的历史）。
 * - key = `xiangwo-orb-conversations:<botId>`；默认 bot（`#bot` 的 value 为空串 =「项我」）用哨兵 `__default`。
 * - 每条会话里也存 `botId`（防御性：不靠 key 反推归属）。
 * - **每个 bot 最多 20 条**（不是总量 20）：切 bot 后各自的 20 条互不挤占。
 * - 旧版单 key `xiangwo-orb-conversations` 的数据**迁移到默认桶**（一次性，迁完删旧 key）。
 */
const STORE_KEY_PREFIX = 'xiangwo-orb-conversations';
const LEGACY_STORE_KEY = 'xiangwo-orb-conversations';
const STORE_MIGRATED_KEY = 'xiangwo-orb-conversations:migrated';
const DEFAULT_BOT_ID = '';
const DEFAULT_BOT_SLOT = '__default';
const MAX_CONVERSATIONS_PER_BOT = 20;

/** 会话桶 key（默认 bot 用哨兵，避免出现空 botId 的 key 片段） */
function botStoreKey(botId) {
  const slot = botId === DEFAULT_BOT_ID || botId === undefined ? DEFAULT_BOT_SLOT : botId;
  return `${STORE_KEY_PREFIX}:${slot}`;
}

function parseList(raw) {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 读某个 bot 的历史（localStorage；图片太大，落盘时丢掉） */
function loadBucket(botId) {
  try {
    return parseList(localStorage.getItem(botStoreKey(botId)));
  } catch {
    return [];
  }
}

function saveBucket(botId, list) {
  try {
    localStorage.setItem(
      botStoreKey(botId),
      JSON.stringify(list.slice(0, MAX_CONVERSATIONS_PER_BOT))
    );
  } catch {
    /* 存储满/隐私模式：历史只在本次会话有效 */
  }
}

/**
 * [XG-CUSTOM] 一次性迁移旧版单 key 数据到默认 bot 桶（数据不能丢）。
 * 用 byId 去重 → 即使迁移标记没写成功、下次再跑一遍也不会重复。
 * @returns {number} 迁移条数
 */
function migrateLegacyConversations() {
  try {
    if (localStorage.getItem(STORE_MIGRATED_KEY) === '1') return 0;
    const legacy = parseList(localStorage.getItem(LEGACY_STORE_KEY));
    let moved = 0;
    if (legacy.length > 0) {
      const existing = loadBucket(DEFAULT_BOT_ID);
      const byId = new Map(existing.map((item) => [item.id, item]));
      for (const item of legacy) {
        const id = typeof item?.id === 'string' ? item.id : '';
        if (id === '' || byId.has(id)) continue;
        byId.set(id, { ...item, botId: DEFAULT_BOT_ID });
        moved += 1;
      }
      saveBucket(DEFAULT_BOT_ID, [...byId.values()]);
    }
    localStorage.setItem(STORE_MIGRATED_KEY, '1');
    localStorage.removeItem(LEGACY_STORE_KEY);
    return moved;
  } catch {
    return 0;
  }
}

/** 所有 bot 的 id（默认「项我」在前；去重） */
function allBotIds() {
  return [...new Set([DEFAULT_BOT_ID, ...BOT_OPTIONS.map((option) => option.id)])];
}

/**
 * [XG-CUSTOM] 跨 bot 找会话：启动时按上次的 session id 恢复，它可能属于任意 bot 桶。
 * @param {string} id 会话 id
 * @returns {{botId: string, conversation: object} | undefined} 命中时带上它所属的 bot
 */
function findConversationAcrossBots(id) {
  for (const botId of allBotIds()) {
    const conversation = loadBucket(botId).find((item) => item.id === id);
    if (conversation !== undefined) return { botId, conversation };
  }
  return undefined;
}

async function main() {
  const panel = document.querySelector('#panel');
  const ball = document.querySelector('#ball');
  const transcript = document.querySelector('#transcript');
  const historyButton = document.querySelector('#history');
  const historyList = document.querySelector('#history-list');
  const captureButton = document.querySelector('#capture');
  const handoffButton = document.querySelector('#handoff');
  const newConversation = document.querySelector('#new-conversation');
  const closeButton = document.querySelector('#close');
  const botSelect = document.querySelector('#bot');
  const permissionRoot = document.querySelector('#permission');
  const permissionButton = document.querySelector('#permission-button');
  const permissionLabel = document.querySelector('#permission-label');
  const permissionMenu = document.querySelector('#permission-menu');
  const status = document.querySelector('#status');
  const prompt = document.querySelector('#prompt');
  const composer = document.querySelector('#composer');
  const stop = document.querySelector('#stop');
  const pagesButton = document.querySelector('#pages');
  const pagesCount = document.querySelector('#pages-count');
  const pagesMenu = document.querySelector('#pages-menu');
  const pagesMenuList = document.querySelector('#pages-menu-list');
  const pagesMenuHint = document.querySelector('#pages-menu-hint');
  const pagesCloseAll = document.querySelector('#pages-close-all');
  const imageButton = document.querySelector('#image');
  const imageInput = document.querySelector('#image-input');
  const fileButton = document.querySelector('#file');
  const fileInput = document.querySelector('#file-input');
  const ballAvatar = document.querySelector('#ball-avatar');
  const selectionBar = document.querySelector('#selection-bar');

  document.querySelector('#input-label').textContent = '跟项我说话';
  prompt.dataset.placeholder = '跟项我说话…';
  prompt.classList.add('prompt-empty');
  stop.setAttribute('aria-label', '停止');
  for (const option of BOT_OPTIONS) {
    const item = document.createElement('option');
    item.value = option.id;
    item.textContent = option.name;
    botSelect.append(item);
  }
  // [XG-CUSTOM] 切 bot → 切历史域（只显示该 bot 的会话；活动会话也换成该 bot 的）
  botSelect.addEventListener('change', () => {
    void switchBot(botSelect.value);
  });

  let expanded = false;
  // [XG-CUSTOM] 期望态：打开路径设 true，关闭路径设 false。防止「等 IPC 期间用户已点关闭」
  // 导致主进程展开、渲染进程还挂着大面板的错位。
  let expandWanted = false;
  let pinned = false;
  let running = false;
  let sending = false;
  let sendAbort;
  let attachedUrl = '';
  let historyOpen = false;
  let permissionOpen = false;
  let permission = 'danger-full-access';
  // [XG-CUSTOM] 自绘拖动状态
  let pointer;
  let dragging = false;
  let dragOrigin;
  let dragFrame;
  let suppressOpen = false;
  /** [XG-CUSTOM] 上一次"点球切换"的时间戳与方向（双击判定 + 撤销那一下，见 DOUBLE_CLICK_GUARD_MS） */
  let lastBallToggleAt = 0;
  /** @type {'open' | 'close' | null} */
  let lastBallToggleBranch = null;
  /** [XG-CUSTOM] 最近一次标定出的 screen 单位系数（1 = screenX 已经是 DIP，1.5 = 物理像素） */
  let lastScreenUnit = 1;
  /** [XG-CUSTOM] 当前 bot（`#bot` 的 value；空串 = 默认「项我」）。历史桶跟着它走。 */
  let currentBotId = botSelect.value;
  let conversations = loadBucket(currentBotId);
  let current = { id: '', title: '', messages: [] };

  // ---------- 会话（按 bot 分桶的本地历史；没有服务端 session，只有身份标记） ----------
  function persistConversations() {
    if (current.id === '') return;
    const index = conversations.findIndex((item) => item.id === current.id);
    const snapshot = {
      id: current.id,
      title: current.title,
      // [XG-CUSTOM] 归属 bot 也写进记录（防御性：不靠桶 key 反推）
      botId: currentBotId,
      // 图片 data URL 不落盘（localStorage 只有几 MB）
      messages: current.messages.map((message) => ({
        role: message.role,
        text: message.text,
        // [XG-CUSTOM] 提问卡的已答状态要跟着历史走（图片 data URL 仍然不落盘）
        ...(typeof message.answer === 'string' && message.answer !== ''
          ? { answer: message.answer }
          : {}),
      })),
    };
    if (index >= 0) conversations[index] = snapshot;
    else conversations = [snapshot, ...conversations];
    saveBucket(currentBotId, conversations);
  }

  /**
   * [XG-CUSTOM] 切 bot = 切历史域：只加载该 bot 的桶，并把活动会话换成该 bot 的一条
   * （有历史就恢复最近一条，没有就新开），保证「当前会话的 botId === 当前选中的 bot」这个不变式，
   * 后续消息只会写进当前 bot 的桶。
   * @param {string} nextBotId 目标 bot（空串 = 默认「项我」）
   */
  async function switchBot(nextBotId) {
    currentBotId = nextBotId;
    if (botSelect.value !== nextBotId) botSelect.value = nextBotId;
    conversations = loadBucket(nextBotId);
    const recent = conversations[0];
    if (recent === undefined) startConversation();
    else current = recent;
    renderHistory();
    renderTranscript();
    await api.floating.setSessionId(current.id);
  }

  function startConversation(id) {
    current = { id: id ?? newId(), title: '新对话', messages: [] };
    persistConversations();
    return current;
  }

  function renderTranscript() {
    transcript.replaceChildren();
    if (current.messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'transcript-empty';
      empty.textContent = '跟项我对话：可 📷 截图当前网页、📤 交接当前活、选 bot 派活。';
      transcript.append(empty);
      return;
    }
    for (const message of current.messages) {
      const row = document.createElement('div');
      row.className = `transcript-row ${message.role}`;
      if (message.img !== undefined && message.img !== '') {
        const image = document.createElement('img');
        image.className = 'transcript-image';
        image.src = message.img;
        image.alt = '';
        row.append(image);
      }
      // [XG-CUSTOM] 助手消息里可能带提问块（协议见文件头 6)）→ 拆成"文字 + 选项卡"
      const parsed = message.role === 'assistant' ? parseQuestionBlock(message.text ?? '') : { text: message.text ?? '' };
      if (parsed.text !== '') {
        const bubble = document.createElement('div');
        bubble.className = 'transcript-bubble';
        bubble.textContent = parsed.text;
        row.append(bubble);
      }
      if (parsed.question !== undefined) {
        row.append(renderQuestionCard(message, parsed.question));
      }
      transcript.append(row);
    }
    transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * [XG-CUSTOM] 渲染一张选项卡（上游 `#question`/`.question-card` 的等价物）。
   * 点选项/提交自定义输入 → 作为一条 user 消息发回去；卡片随即置为已答（灰掉）。
   * @param {object} message 所属助手消息（`message.answer` 记录已答内容，随历史落盘）
   * @param {{title: string, options: string[], allowCustom: boolean}} question 解析出来的提问
   * @returns {HTMLElement} 卡片元素
   */
  function renderQuestionCard(message, question) {
    const card = document.createElement('div');
    card.className = 'question-card';
    const title = document.createElement('div');
    title.className = 'question-title';
    title.textContent = question.title;
    card.append(title);

    const answered = typeof message.answer === 'string' && message.answer !== '';
    const answer = (value) => {
      if (answered) return;
      const text = value.trim();
      if (text === '') return;
      message.answer = text;
      persistConversations();
      renderTranscript();
      void send(text);
    };

    if (question.options.length > 0) {
      const list = document.createElement('div');
      list.className = 'question-options';
      for (const option of question.options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className =
          answered && message.answer === option ? 'question-option chosen' : 'question-option';
        button.textContent = option;
        button.disabled = answered;
        button.addEventListener('click', () => answer(option));
        list.append(button);
      }
      card.append(list);
    }

    if (question.allowCustom && !answered) {
      const form = document.createElement('form');
      form.className = 'question-custom';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '或者自己写一个答案…';
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = '发送';
      form.append(input, submit);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        answer(input.value);
      });
      card.append(form);
    } else if (answered) {
      const done = document.createElement('div');
      done.className = 'question-answered';
      done.textContent = `已答：${message.answer}`;
      card.append(done);
    }
    return card;
  }

  function renderHistory() {
    historyList.replaceChildren();
    if (conversations.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '还没有历史对话';
      historyList.append(empty);
      return;
    }
    for (const item of conversations) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = item.id === current.id ? 'history-row current' : 'history-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(item.id === current.id));
      row.textContent = item.title === '' ? '未命名对话' : item.title;
      row.addEventListener('click', () => {
        setHistoryOpen(false);
        // [XG-CUSTOM] 记录里的 botId 说了算：跟当前选中的不一致就先把选择器切过去（防串台）
        const itemBotId = typeof item.botId === 'string' ? item.botId : DEFAULT_BOT_ID;
        if (itemBotId !== currentBotId) {
          currentBotId = itemBotId;
          botSelect.value = itemBotId;
          conversations = loadBucket(itemBotId);
        }
        current = item;
        persistConversations();
        renderTranscript();
        void api.floating.setSessionId(current.id);
      });
      historyList.append(row);
    }
  }

  function setHistoryOpen(next) {
    historyOpen = next;
    historyList.hidden = !historyOpen;
    transcript.hidden = historyOpen;
    historyButton.setAttribute('aria-pressed', String(historyOpen));
    if (historyOpen) {
      setPermissionOpen(false);
      renderHistory();
    }
  }

  // ---------- 外壳：球 ↔ 面板 ----------
  function applyDirection(state) {
    const horizontal = state?.horizontal === 'left' ? 'left' : 'right';
    const vertical = state?.vertical === 'up' ? 'up' : 'down';
    document.body.classList.toggle('expand-left', horizontal === 'left');
    document.body.classList.toggle('expand-right', horizontal === 'right');
    document.body.classList.toggle('expand-up', vertical === 'up');
    document.body.classList.toggle('expand-down', vertical === 'down');
  }

  function setRunning(next) {
    running = next === true;
    document.body.classList.toggle('running', running);
    stop.hidden = !expanded || !running;
    void api.floating.setSessionRunning(running);
  }

  // [XG-CUSTOM] 面板挂载/卸载：收起态必须 display:none（上游只靠 opacity:0，
  // 透明窗口里会漏出深色方块）。挂载 → 强制回流（让 display:flex 先生效）→ 再加 body.expanded 触发淡入。
  // 注意：两个状态类都加在 **body** 上（orb.css 里是 `body.panel-mounted #panel` / `body.expanded #panel`）。
  // 之前把 panel-mounted 加到了 #panel 元素上，选择器不匹配 → 面板永远 display:none，
  // 展开时窗口只有球 + 一片黑（用户实测反馈）。
  function mountPanel() {
    panel.hidden = false;
    document.body.classList.add('panel-mounted');
  }

  function unmountPanel() {
    document.body.classList.remove('expanded', 'panel-mounted');
    panel.hidden = true;
  }

  /**
   * [XG-CUSTOM] 「现在看得见面板吗」的 DOM 事实。
   * 判定放宽到**真的可见**（`hidden` + computed `display`），不再依赖某个 class 恰好被加上；
   * CSS 兜底 `body:not(.expanded) #panel { display:none !important }` 也一并覆盖。
   * @returns {boolean} 面板是否处于可见态
   */
  function panelVisible() {
    if (panel.hidden) return false;
    return getComputedStyle(panel).display !== 'none';
  }

  /**
   * [XG-CUSTOM] 面板开/关的**权威判定**：先问主进程（窗口态/尺寸的唯一权威 —— 球窗口是它 setBounds 的），
   * IPC 读不到才退回 DOM 可见性。这样即使渲染进程的 class/变量时序出错，展开态点球也一定走"收起"，
   * 不会再误判成 openPanel 导致"毫无反应"。
   * @returns {Promise<{ open: boolean, source: 'main' | 'dom' }>}
   */
  async function panelOpenState() {
    if (typeof bridge.getOrbMode === 'function') {
      try {
        const state = await bridge.getOrbMode();
        if (Array.isArray(state) && (state[0] === 'panel' || state[0] === 'ball')) {
          return { open: state[0] === 'panel', source: 'main' };
        }
      } catch {
        /* 读不到就看 DOM */
      }
    }
    return { open: panelVisible(), source: 'dom' };
  }

  async function setExpanded(next) {
    if (next) {
      expandWanted = true;
      const state = await api.floating.setExpanded(true);
      // 等 IPC 期间用户已经点了关闭：把主进程那边撤回去，且不要挂面板
      if (!expandWanted) {
        void api.floating.setExpanded(false);
        return;
      }
      applyDirection(state);
      mountPanel();
      void panel.offsetHeight; // 强制回流：display 生效后再加 expanded，120ms 淡入才会跑
      expanded = true;
      document.body.classList.add('expanded');
      stop.hidden = !running;
      // [XG-CUSTOM][TEMP-TRACE] 展开成型后的现场：球的位置/命中/形状相关事实（真机排查用）
      trace('panel-open-done', { direction: state, ...ballDebug() });
      // [XG-CUSTOM] 面板打开时刷新"网页 N"，并开启 5s 轻量轮询（收起时停掉）
      void refreshPages();
      syncPagesPolling();
      return;
    }
    expandWanted = false;
    expanded = false;
    stop.hidden = true;
    unmountPanel();
    syncPagesPolling();
    await api.floating.setExpanded(false);
  }

  // [XG-CUSTOM] 交互模型：单击球 = 切换开/关。收起态 → 打开并保持（pin），展开态 → closePanel()。
  // pin 先本地生效（立刻有描边反馈），再用主进程返回值对账，整体只有一次 IPC 往返 → 跟手。
  async function openPanel() {
    trace('open-panel', { pinned, expanded, domVisible: panelVisible(), mode: await panelOpenState() });
    if (!pinned) {
      applyPinned(true);
      void bridge.orbTogglePin?.().then((next) => applyPinned(next));
    }
    await setExpanded(true);
  }

  async function closePanel() {
    trace('close-panel', { pinned, expanded, domVisible: panelVisible(), mode: await panelOpenState() });
    if (pinned) {
      applyPinned(false);
      void bridge.orbTogglePin?.().then((next) => applyPinned(next));
    }
    await setExpanded(false);
    status.textContent = '';
  }

  function applyPinned(next) {
    pinned = next === true;
    document.body.classList.toggle('pinned', pinned);
  }

  // ---------- 权限档（read-only | workspace-write | danger-full-access，与我们一致） ----------
  function renderPermission() {
    permissionLabel.textContent = permissionText(permission);
    permissionButton.setAttribute('aria-label', permissionText(permission));
    permissionButton.title = permissionText(permission);
    for (const option of permissionMenu.querySelectorAll('[data-preset]')) {
      option.setAttribute('aria-selected', String(option.dataset.preset === permission));
    }
  }

  function setPermissionOpen(next) {
    permissionOpen = next;
    permissionMenu.hidden = !permissionOpen;
    permissionButton.setAttribute('aria-expanded', String(permissionOpen));
  }

  for (const preset of PERMISSION_PRESETS) {
    const item = document.createElement('li');
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.preset = preset;
    option.setAttribute('role', 'option');
    option.textContent = permissionText(preset);
    option.addEventListener('click', () => {
      permission = preset;
      setPermissionOpen(false);
      renderPermission();
      void api.floating.setOverlayPermission(permission, current.id);
    });
    item.append(option);
    permissionMenu.append(item);
  }
  renderPermission();
  permissionButton.addEventListener('click', (event) => {
    event.stopPropagation();
    setHistoryOpen(false);
    setPermissionOpen(!permissionOpen);
  });
  document.addEventListener('pointerdown', (event) => {
    if (permissionRoot.contains(event.target)) return;
    setPermissionOpen(false);
  });

  // ---------- 输入框 ----------
  function draftOverflows() {
    return prompt.scrollHeight > prompt.clientHeight + 1;
  }

  function syncComposerHeight() {
    const empty = promptText(prompt).trim() === '';
    prompt.classList.toggle('prompt-empty', empty);
    document.body.classList.remove('composer-capped');
    if (empty) {
      document.body.style.setProperty('--composer-height', 'var(--ball)');
      return;
    }
    let height = COMPOSER_MIN_PX;
    for (;;) {
      document.body.style.setProperty('--composer-height', `${String(height)}px`);
      if (!draftOverflows() || height >= COMPOSER_MAX_PX) break;
      height = Math.min(COMPOSER_MAX_PX, height + COMPOSER_LINE_PX);
    }
    document.body.classList.toggle('composer-capped', draftOverflows());
  }

  function clearPrompt() {
    prompt.textContent = '';
    prompt.classList.add('prompt-empty');
    document.body.classList.remove('composer-capped');
    document.body.style.setProperty('--composer-height', 'var(--ball)');
  }

  prompt.addEventListener('input', () => {
    syncComposerHeight();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    if (typeof composer.requestSubmit === 'function') composer.requestSubmit();
    else composer.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  prompt.addEventListener('paste', (event) => {
    event.preventDefault();
    // [XG-CUSTOM] 粘贴的图片：走发图路径（旧浮窗只处理 text/plain，图片会被丢掉）
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.some((file) => file.type.startsWith('image/'))) {
      void handleIncomingFiles(files);
      return;
    }
    insertPlainText(prompt, event.clipboardData?.getData('text/plain') ?? '');
    syncComposerHeight();
  });
  composer.addEventListener('click', (event) => {
    if (event.target === composer) prompt.focus();
  });

  // ---------- 聊天（我们的 8900 通道） ----------
  function buildOutbound(text) {
    const botId = botSelect.value;
    let outbound = botId === '' ? text : `@${botId} ${text}`;
    if (attachedUrl !== '') outbound = `${outbound}\n[当前网页] ${attachedUrl}`;
    return outbound;
  }

  function priorHistory() {
    return current.messages.map((message) => ({ role: message.role, content: message.text }));
  }

  /**
   * [XG-CUSTOM] 聊天地址（主进程解析，preload 暴露）。
   * - 懒解析：第一条消息才问主进程（球常驻，没必要启动就 IPC）。
   * - 每次**失败后作废**（见 send 的 catch）：主机换了 / 隧道断了 / 8900 刚重启，
   *   下一条消息会重新解析，不会一直卡在过期的地址上。
   */
  let chatTarget;

  async function chatEndpoint() {
    if (chatTarget === undefined) chatTarget = await resolveXiangwoChatUrl(bridge);
    return chatTarget;
  }

  async function send(text, image) {
    const instruction = text.trim();
    if (sending) return;
    if (instruction === '' && (image === undefined || image === '')) return;
    sending = true;
    if (current.id === '') startConversation();
    const prior = priorHistory();
    const outbound = buildOutbound(instruction);
    const display = instruction === '' ? '（图片）' : instruction;
    if (current.title === '' || current.title === '新对话') current.title = display.slice(0, 40);
    current.messages.push(
      image === undefined || image === ''
        ? { role: 'user', text: display }
        : { role: 'user', text: display, img: image }
    );
    persistConversations();
    renderTranscript();
    clearPrompt();
    setHistoryOpen(false);
    setPermissionOpen(false);
    setRunning(true);
    const userContent =
      image === undefined || image === ''
        ? outbound
        : [
            { type: 'text', text: outbound },
            { type: 'image_url', image_url: { url: image } },
          ];
    const controller = new AbortController();
    sendAbort = controller;
    try {
      const target = await chatEndpoint();
      // [XG-CUSTOM] 主进程判定地址不可达（远程主机 + 没法转发）→ 先把人话提示摆出来，
      // 请求照发（万一网络其实通），失败文案仍然照旧。
      if (!target.reachable && target.hint !== '') status.textContent = target.hint;
      const data = await sendXiangwoChat({
        url: target.url,
        signal: controller.signal,
        body: {
          messages: [
            { role: 'system', content: systemPrefixFor(permission) },
            ...prior,
            { role: 'user', content: userContent },
          ],
        },
        // [XG-CUSTOM] 重试期间给反馈（别静默等 15 秒空窗）
        onRetry: (attempt) => {
          status.textContent = retryStatusText(attempt);
        },
      });
      status.textContent = '';
      current.messages.push({ role: 'assistant', text: replyTextOf(data) });
    } catch (cause) {
      // [XG-CUSTOM] 地址可能过期（主机/隧道变了）→ 作废缓存，下一条重新解析
      chatTarget = undefined;
      current.messages.push({
        role: 'assistant',
        text: controller.signal.aborted ? '（已停止）' : failureText(cause),
      });
    } finally {
      if (sendAbort === controller) sendAbort = undefined;
      sending = false;
      persistConversations();
      renderTranscript();
      setRunning(false);
      // [XG-CUSTOM] 聊完/停止后刷新 agent 网页计数（agent 可能在回答里开了新页面）
      void refreshPages();
    }
  }

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const instruction = promptText(prompt).trim();
    if (instruction === '') return;
    void send(instruction);
  });

  stop.addEventListener('click', () => {
    sendAbort?.abort();
  });

  // ---------- 我们的动作：📷 截图 / 📤 交接 / 新对话 / 打开主窗 ----------
  async function captureCurrentTab() {
    if (typeof bridge.captureCurrentTab !== 'function') {
      status.textContent = '（截图桥接未就绪，请说「截图」让 agent 截）';
      return;
    }
    try {
      const dataUrl = await bridge.captureCurrentTab();
      attachedUrl = (await bridge.getCurrentTabUrl?.()) ?? '';
      await send('', dataUrl);
    } catch (cause) {
      status.textContent = `截图失败: ${describeError(cause)}`;
    }
  }

  async function handoff() {
    if (typeof bridge.taskSpaceList !== 'function') {
      status.textContent = '（交接桥接未就绪）';
      return;
    }
    try {
      const list = await bridge.taskSpaceList();
      const rows = Array.isArray(list) ? list : [];
      if (rows.length === 0) {
        status.textContent = '（当前没有可交接的活）';
        return;
      }
      const target = rows[0];
      await bridge.taskSpaceHandoff?.(target.id);
      status.textContent = `📤 已把「${String(target.name ?? target.id)}」交接到主工作台`;
    } catch (cause) {
      status.textContent = `交接失败: ${describeError(cause)}`;
    }
  }

  async function startNewConversation() {
    clearPrompt();
    setHistoryOpen(false);
    setPermissionOpen(false);
    setRunning(false);
    attachedUrl = '';
    status.textContent = '';
    startConversation();
    renderTranscript();
    await api.floating.setSessionId(current.id);
    await api.floating.onCreateSession();
  }

  /**
   * [XG-CUSTOM] agent 网页计数 + 一键清理。
   *
   * 痛点：浏览器 page 开太多会把机器拖死（用户这台被 Chrome 一堆 page + swap 满卡过）。
   * 主进程 `xiangwo:pages` 走 CDP（127.0.0.1:9222）列页面，**只列"非本地/非 chrome://"的外部网页**
   * （无法可靠区分"谁开的"，所以保守处理：平台页/本地页永不列出、永不关；UI 上也写明"只关外部网页"）。
   * CDP 不可达 → 主进程返回 `{ok:false,error}`，这里显示人话提示，不崩、不报错。
   *
   * 刷新时机：面板打开时、每次聊完/停止后、以及自己动作之后；展开态每 5s 轻量轮询一次。
   */
  let pagesPollTimer;
  let pagesSnapshot = [];

  async function refreshPages() {
    if (pagesButton === null || pagesCount === null) return;
    let result;
    try {
      result = await bridge.xiangwoPages?.();
    } catch (cause) {
      result = { ok: false, error: describeError(cause) };
    }
    if (result === undefined || result === null) {
      pagesButton.hidden = true;
      return;
    }
    if (result.ok === false) {
      // CDP 不可达：按钮藏起来，菜单里给人话提示（不抛错、不崩）
      pagesButton.hidden = true;
      pagesSnapshot = [];
      pagesMenuHint.textContent = String(result.error ?? '读不到 agent 网页');
      if (pagesMenu !== null && !pagesMenu.hidden) renderPagesMenu();
      return;
    }
    pagesSnapshot = Array.isArray(result.pages) ? result.pages : [];
    pagesButton.hidden = pagesSnapshot.length === 0; // 0 个就隐藏（不占地方）
    pagesCount.textContent = String(pagesSnapshot.length);
    pagesMenuHint.textContent = '';
    if (pagesMenu !== null && !pagesMenu.hidden) renderPagesMenu();
  }

  function renderPagesMenu() {
    if (pagesMenuList === null) return;
    pagesMenuList.replaceChildren();
    if (pagesSnapshot.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pages-empty';
      empty.textContent = pagesMenuHint.textContent === '' ? '当前没有 agent 打开的网页' : pagesMenuHint.textContent;
      pagesMenuList.append(empty);
      if (pagesCloseAll !== null) pagesCloseAll.disabled = true;
      return;
    }
    if (pagesCloseAll !== null) pagesCloseAll.disabled = false;
    for (const page of pagesSnapshot.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'pages-row';
      const label = document.createElement('div');
      label.className = 'pages-label';
      const title = document.createElement('div');
      title.className = 'pages-title';
      title.textContent = page.title;
      const url = document.createElement('div');
      url.className = 'pages-url';
      let host = page.url;
      try {
        host = new URL(page.url).host;
      } catch {
        /* 保留原串 */
      }
      url.textContent = host;
      label.append(title, url);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'pages-close';
      close.title = '关掉这个网页';
      close.textContent = '✕';
      close.addEventListener('click', () => void closePages({ ids: [page.id] }));
      row.append(label, close);
      pagesMenuList.append(row);
    }
    if (pagesSnapshot.length > 8) {
      const more = document.createElement('div');
      more.className = 'pages-empty';
      more.textContent = `还有 ${pagesSnapshot.length - 8} 个，用「关闭全部」一次清理`;
      pagesMenuList.append(more);
    }
  }

  async function closePages(args) {
    try {
      await bridge.xiangwoClosePages?.(args);
    } catch (cause) {
      status.textContent = `关网页失败: ${describeError(cause)}`;
    }
    await refreshPages();
  }

  function setPagesMenuOpen(next) {
    if (pagesMenu === null) return;
    pagesMenu.hidden = !next;
    if (next) {
      renderPagesMenu();
      void refreshPages();
    }
  }

  /** 只在面板展开时每 5s 轻量刷新一次计数 */
  function syncPagesPolling() {
    const shouldPoll = expanded;
    if (shouldPoll && pagesPollTimer === undefined) {
      pagesPollTimer = setInterval(() => void refreshPages(), 5000);
    } else if (!shouldPoll && pagesPollTimer !== undefined) {
      clearInterval(pagesPollTimer);
      pagesPollTimer = undefined;
      setPagesMenuOpen(false);
    }
  }

  /**
   * [XG-CUSTOM] 发图 / 发文件（照旧浮窗 `XiangwoFloatingPanel.tsx` 的实现搬过来）：
   * - 图片：`FileReader.readAsDataURL` → `send('', dataUrl)` → 请求体里是 image_url 结构；
   *   **dataURL 不落盘**：`persistConversations()` 只保留 role/text/answer（图片只在内存里）。
   * - 其它文件：`readAsText` → `send('[文件 <name>]\n' + 前 8000 字)`。
   * @param {File[]} files 待处理文件（来自 file input / paste / drop）
   */
  async function handleIncomingFiles(files) {
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          const dataUrl = await readFileAsDataUrl(file);
          if (typeof dataUrl === 'string' && dataUrl !== '') await send('', dataUrl);
          continue;
        }
        const text = await readFileAsText(file);
        await send(`[文件 ${file.name}]\n${text.slice(0, 8000)}`);
      } catch (cause) {
        status.textContent = `读取文件失败: ${describeError(cause)}`;
      }
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
      reader.readAsText(file);
    });
  }

  /** 拖拽文件到面板：图片走发图、其它走发文件（dragover 必须 preventDefault，否则浏览器不认 drop） */
  function wireDropTarget() {
    if (panel === null) return;
    panel.addEventListener('dragover', (event) => {
      event.preventDefault();
      document.body.classList.add('drop-active');
    });
    panel.addEventListener('dragleave', () => {
      document.body.classList.remove('drop-active');
    });
    panel.addEventListener('drop', (event) => {
      event.preventDefault();
      document.body.classList.remove('drop-active');
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) void handleIncomingFiles(files);
    });
  }

  /**
   * [XG-CUSTOM] 划词工具条（**范围内版**）：只在球面板的转录区里选中文字时弹出，
   * 提供「搜索 / 翻译 / 发给项我」。零系统依赖、不碰全局快捷键。
   *
   * 全局版（任意应用里选中文字 → 快捷键唤起）**TODO**：
   *   - 取选区要走系统：Linux 用 `xdotool getactivewindow` + `xclip -o -selection primary`
   *     （或 X11 XRecord/XTEST），还要注册全局快捷键（Electron 无原生 API，得 globalShortcut +
   *     读取主选区，Wayland 下另需 wl-clipboard/portal）。
   *   - 上游只有 macOS/Win 实现；Linux 这条属系统级依赖，先不做（需求方也同意留 TODO）。
   */
  function wireSelectionBar() {
    if (selectionBar === null) return;
    const readSelection = () => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) return undefined;
      const text = selection.toString().trim();
      if (text === '') return undefined;
      const anchor = selection.anchorNode;
      const inTranscript =
        anchor !== null &&
        (transcript.contains(anchor) || transcript === anchor || transcript.contains(anchor.parentNode));
      if (!inTranscript) return undefined;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      return { text, rect };
    };

    const hideBar = () => {
      selectionBar.hidden = true;
    };

    document.addEventListener('mouseup', (event) => {
      // 点在工具条自己身上就别动（否则按钮点不到）
      if (selectionBar.contains(event.target)) return;
      const found = readSelection();
      if (found === undefined) {
        hideBar();
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const barWidth = 190;
      const barHeight = 30;
      const left = Math.min(
        Math.max(8, found.rect.left - panelRect.left + found.rect.width / 2 - barWidth / 2),
        Math.max(8, panelRect.width - barWidth - 8)
      );
      const top = Math.max(8, found.rect.top - panelRect.top - barHeight - 6);
      selectionBar.style.left = `${Math.round(left)}px`;
      selectionBar.style.top = `${Math.round(top)}px`;
      selectionBar.hidden = false;
      selectionBar.dataset.selection = found.text;
    });
    document.addEventListener('selectionchange', () => {
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) hideBar();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideBar();
    });
    selectionBar.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button === null) return;
      const text = selectionBar.dataset.selection ?? '';
      if (text === '') return;
      const action = button.dataset.action;
      hideBar();
      if (action === 'search') {
        void orbApi('host.openExternal', {
          url: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
        });
        return;
      }
      if (action === 'translate') {
        prompt.textContent = `把下面这段翻译成中文：\n${text}`;
        syncComposerHeight();
        prompt.focus();
        return;
      }
      if (action === 'send') void send(text);
    });
  }

  // ---------- 事件绑定 ----------
  historyButton.addEventListener('click', () => {
    setHistoryOpen(!historyOpen);
  });
  captureButton.addEventListener('click', () => {
    void captureCurrentTab();
  });
  // [XG-CUSTOM] 🖼️/📎：按钮点开隐藏 input；change 后要走完整条发图/发文件路径并清空 value
  pagesButton?.addEventListener('click', () => setPagesMenuOpen(pagesMenu?.hidden === true));
  pagesCloseAll?.addEventListener('click', () => void closePages({ all: true }));
  document.addEventListener('pointerdown', (event) => {
    if (pagesMenu === null || pagesMenu.hidden) return;
    if (pagesMenu.contains(event.target) || pagesButton?.contains(event.target) === true) return;
    setPagesMenuOpen(false);
  });
  imageButton?.addEventListener('click', () => imageInput?.click());
  fileButton?.addEventListener('click', () => fileInput?.click());
  imageInput?.addEventListener('change', () => {
    const files = [...(imageInput.files ?? [])];
    imageInput.value = '';
    if (files.length > 0) void handleIncomingFiles(files);
  });
  fileInput?.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) void handleIncomingFiles(files);
  });
  handoffButton.addEventListener('click', () => {
    void handoff();
  });
  newConversation.addEventListener('click', () => {
    void startNewConversation();
  });
  closeButton.addEventListener('click', () => {
    void closePanel();
  });

  // [XG-CUSTOM] 自绘拖动：不用 -webkit-app-region: drag（它会吞掉 click/dblclick，导致"点不开面板"）。
  // pointerdown 记抓取偏移 → pointermove 位移 > 4 DIP 才算拖动（rAF 节流 ~16ms 调 orbDrag）→
  // pointerup 位移没超阈值 = 单击 → **切换**：收起态打开并保持、展开态收起（等价于点 ✕）。
  // 捕获指针保证窗口跟着移动时事件不断。
  // 拖动两种态都走同一条通道，差别在主进程 moveOrbBall：收起态移动球、展开态平移整个面板（尺寸不变）。
  //
  // [XG-CUSTOM] **单位**：`event.screenX/screenY` 在真机（X11 + 1.5x 缩放）上实测是**物理像素**，
  // 而 `clientX/clientY`、`getBoundingClientRect()` 是 CSS px（= DIP，主进程 setBounds 也用 DIP）。
  // 混着用会出两个真机故障：
  //   ① 阈值 4 变成"4 物理像素"= 2.67 DIP → 手一抖（>2.67 DIP）就判定成拖动 → **单击开关被吞掉**
  //      （真机「展开态点球没反应、✕ 却能收起」的根因）；
  //   ② orbDrag 传出去的坐标带上 (scale-1) 倍偏差 → 面板跳到错误位置（真机 xiangwo-orb.json 里
  //      ball.x=2126 就是被 1.5 倍偏差写歪的证据：那次向左拖，窗口反而右移了 365 DIP）。
  // 解决：每次手势先用「窗口还没被移动」时的 Δscreen/Δclient 标定一次系数（实测 1.5），
  // 之后所有 screen 坐标先除它再参与阈值与坐标计算。标不出来就按 1（视为本来就是 DIP，行为同旧版）。
  function detectScreenUnit(event) {
    if (pointer === undefined || pointer.unitDetected) return;
    // 用**从按下点累计**的位移算比值：单击的抖动可能分散成好几个 <1px 的事件，
    // 逐事件算会一直算不出来；而拖动的窗口跟随还没开始（主进程第一次 orbDrag 在阈值之后才发），
    // 所以累计值此时仍然"干净"。
    const ds = Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY);
    const dc = Math.hypot(
      event.clientX - pointer.startClientX,
      event.clientY - pointer.startClientY
    );
    if (dc < 1) return; // 位移太小，比值不可靠
    const ratio = ds / dc;
    if (ratio < 0.5 || ratio > 4) return;
    pointer.unit = ratio;
    pointer.unitDetected = true;
    lastScreenUnit = ratio;
    trace('ball-screen-unit', {
      ratio: Math.round(ratio * 1000) / 1000,
      dpr: window.devicePixelRatio,
      ds: Math.round(ds),
      dc: Math.round(dc),
    });
  }

  function queueBallMove(x, y) {
    dragOrigin = { x, y };
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      const origin = dragOrigin;
      if (origin === undefined) return;
      void bridge.orbDrag?.(origin.x, origin.y);
    });
  }

  /**
   * 收尾一次按下：清状态、必要时落盘位置。
   * @param consume true = 由 pointerup 之外的路径收尾（丢捕获/取消）→ 抑制紧随其后的假点击
   * @returns 这次按下是不是"拖动"（true 时 pointerup 不会切换开/关）
   */
  async function finishBallPointer(consume) {
    if (dragFrame !== undefined) {
      cancelAnimationFrame(dragFrame);
      dragFrame = undefined;
    }
    const origin = dragOrigin;
    dragOrigin = undefined;
    const wasDragging = dragging;
    dragging = false;
    pointer = undefined;
    document.body.classList.remove('dragging');
    if (!wasDragging) return false;
    if (consume === true) suppressOpen = true;
    if (origin !== undefined) await bridge.orbDrag?.(origin.x, origin.y);
    await bridge.orbDragEnd?.();
    return true;
  }

  ball.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      trace('ball-pointerdown-ignored', { button: event.button, ...ballDebug() });
      return;
    }
    // [XG-CUSTOM] 新一次按下 = 新一次手势：把上一次手势可能留下的"抑制开关"清掉。
    // （否则被 lostpointercapture/pointercancel 收尾的那次拖动会把紧随其后的**下一次**单击吃掉。）
    suppressOpen = false;
    dragging = false;
    const rect = ball.getBoundingClientRect();
    pointer = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.screenX,
      startY: event.screenY,
      // [XG-CUSTOM] screen 单位标定（见 detectScreenUnit）：默认 1 = 已经是 DIP
      unit: 1,
      unitDetected: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    trace('ball-pointerdown', {
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      domVisible: panelVisible(),
      expanded,
      ...ballDebug(),
    });
    ball.setPointerCapture(event.pointerId);
  });

  ball.addEventListener('pointermove', (event) => {
    if (pointer === undefined) return;
    if ((event.buttons & 1) !== 1) {
      void finishBallPointer(true);
      return;
    }
    // [XG-CUSTOM] 先标定 screen 单位（窗口还没被移动时 Δscreen/Δclient 才准）
    detectScreenUnit(event);
    const unit = pointer.unit;
    if (!dragging) {
      const moved =
        Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) / unit;
      if (moved <= DRAG_THRESHOLD_PX) return;
      dragging = true;
      document.body.classList.add('dragging');
      trace('ball-drag-start', {
        movedDip: Math.round(moved),
        thresholdDip: DRAG_THRESHOLD_PX,
        unit,
        ...ballDebug(),
      });
    }
    // screen（可能物理像素）→ DIP 后再当"球左上角目标"发出去
    queueBallMove(event.screenX / unit - pointer.dx, event.screenY / unit - pointer.dy);
  });

  ball.addEventListener('pointerup', (event) => {
    if (event.button !== 0) {
      void finishBallPointer(true);
      return;
    }
    // [XG-CUSTOM] 先抓住这次手势的参数（finishBallPointer 会把它清掉）：判"单击 vs 拖动"和"归位"
    const gesture = pointer;
    void finishBallPointer(false).then(async (dragged) => {
      const blocked = suppressOpen;
      suppressOpen = false;
      // [XG-CUSTOM] 单击 vs 拖动用**总位移**判（阈值 CLICK_MAX_PX DIP），不再只看过程里的 dragging：
      // 真实鼠标单击的手抖常常超过"起拖"阈值（4 DIP），旧逻辑就会把它当成拖动 → 把单击开关吞掉
      // （真机「展开态点球没反应、✕ 却正常」）。这里：总位移 ≤ CLICK_MAX_PX 就算单击，
      // 并且把被拖出去的那几像素**挪回按下前的位置**（不然每点一次球都漂几像素）。
      const totalDip =
        gesture === undefined
          ? 0
          : Math.hypot(event.screenX - gesture.startX, event.screenY - gesture.startY) /
            gesture.unit;
      const isClick = totalDip <= CLICK_MAX_PX;
      if (isClick && dragged && gesture !== undefined && gesture.unitDetected) {
        await bridge.orbDrag?.(
          gesture.startX / gesture.unit - gesture.dx,
          gesture.startY / gesture.unit - gesture.dy
        );
        await bridge.orbDragEnd?.();
      }
      // [XG-CUSTOM] 面板开/关的权威判定：主进程窗口态优先，DOM 可见性兜底
      const { open, source } = await panelOpenState();
      const branch = !isClick || blocked ? 'none' : open ? 'close' : 'open';
      trace('ball-pointerup', {
        button: event.button,
        dragged,
        blocked,
        isClick,
        totalDip: Math.round(totalDip),
        clickMaxDip: CLICK_MAX_PX,
        modeSource: source,
        domVisible: panelVisible(),
        expanded,
        branch,
        screenUnit: lastScreenUnit,
        ...ballDebug(),
      });
      if (branch === 'none') return;
      // [XG-CUSTOM] 连点两下（DOUBLE_CLICK_GUARD_MS 内）= 双击：打开 emdash 主窗口，
      // 并把第一次单击那下切换**撤销**掉（净效果：面板状态跟双击前一致，不会"开→关"乱掉）。
      const now = Date.now();
      const sinceMs = now - lastBallToggleAt;
      if (sinceMs < DOUBLE_CLICK_GUARD_MS) {
        const undo = lastBallToggleBranch === 'close' ? 'open' : 'close';
        lastBallToggleAt = 0;
        lastBallToggleBranch = null;
        trace('ball-double-click', { sinceMs, undo });
        await (undo === 'close' ? closePanel() : openPanel());
        void bridge.orbOpenMain?.();
        return;
      }
      lastBallToggleAt = now;
      lastBallToggleBranch = branch;
      if (branch === 'close') void closePanel();
      else void openPanel();
    });
  });
  ball.addEventListener('pointercancel', () => {
    void finishBallPointer(true);
  });
  // 原生菜单/其它窗口抢指针时也要收尾，否则会一直以为自己还在拖
  ball.addEventListener('lostpointercapture', () => {
    trace('ball-lost-capture', { hadPointer: pointer !== undefined, dragging });
    void finishBallPointer(true);
  });
  // [XG-CUSTOM] 右键菜单（照 Orb 原版）。菜单本体在主进程用 Electron 原生 Menu 弹
  // （收起态球窗口只有 96×96 且被 X11 SHAPE 抠成一颗圆，自绘 DOM 菜单根本画不出来 —— 见
  // main/host/xiangwo-orb-api.ts 的 popupOrbContextMenu）。这里只负责：阻止默认菜单、把
  // 选中动作翻译成既有桥接调用。右键不算拖动/开关：pointerdown/up 的 button!==0 分支已直接 return。
  ball.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    trace('ball-contextmenu', {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      domVisible: panelVisible(),
      ...ballDebug(),
    });
    void runOrbContextMenu();
  });

  async function runOrbContextMenu() {
    let action = null;
    try {
      action = await api.floating.contextMenu();
    } catch (cause) {
      trace('contextmenu-error', { error: describeError(cause) });
      return;
    }
    trace('contextmenu-action', { action });
    if (action === 'open-main') void bridge.orbOpenMain?.();
    else if (action === 'toggle-panel') {
      const { open } = await panelOpenState();
      await (open ? closePanel() : openPanel());
    }
    else if (action === 'quit') void bridge.orbQuit?.();
  }

  bridge.onOrbMode?.((mode, isPinned, direction) => {
    applyPinned(isPinned);
    // [XG-CUSTOM] 主进程带了方向就跟着换角的类（移动导致方向变化时，这里是唯一的同步点）
    if (direction !== undefined && direction !== null) applyDirection(direction);
    // [XG-CUSTOM] 主进程是「窗口尺寸」的唯一权威：它说收起就无条件同步收起 UI，
    // 避免出现「主进程已缩回球态、渲染进程还挂着大面板」的错位。
    if (mode !== 'panel' && expanded) {
      expandWanted = false;
      void setExpanded(false);
    }
  });
  void bridge.getOrbMode?.().then((state) => {
    if (!Array.isArray(state)) return;
    applyPinned(state[1]);
  });

  // ---------- 启动 ----------
  // [XG-CUSTOM] 先把旧版单 key 历史迁进默认 bot 桶（数据不能丢），再按会话 id 找它属于哪个 bot
  const migrated = migrateLegacyConversations();
  if (migrated > 0) trace('history-migrated', { moved: migrated, to: 'default-bot' });
  // [XG-CUSTOM] 迁移可能刚写进当前桶：**必须重读**，否则下面 startConversation() 的 persist
  // 会用"迁移前那份空列表"把迁移结果覆盖掉（升级路径会丢历史 —— 自检 ④-h 抓到的真 bug）
  conversations = loadBucket(currentBotId);
  const stored = await api.floating.sessionId();
  const found =
    typeof stored === 'string' && stored !== '' ? findConversationAcrossBots(stored) : undefined;
  if (found !== undefined) {
    // 会话属于哪个 bot 就把选择器切到哪个 bot（否则会串台）
    ({ botId: currentBotId } = found);
    botSelect.value = currentBotId;
    conversations = loadBucket(currentBotId);
    current = found.conversation;
  } else {
    startConversation(typeof stored === 'string' && stored !== '' ? stored : undefined);
    await api.floating.setSessionId(current.id);
  }
  try {
    const savedPreset = await api.floating.overlayPermission();
    if (PERMISSION_PRESETS.includes(savedPreset)) permission = savedPreset;
  } catch {
    /* 读不到就用默认「完全访问」 */
  }
  // [XG-CUSTOM] 启动即保证收起态：面板不挂载 = display:none，窗口里只有球（其余 100% 透明）。
  unmountPanel();
  renderTranscript();
  renderHistory();
  renderPermission();
  applyPinned(false);
  // [XG-CUSTOM] 自定义头像（上游 orb-avatar.ts 的等价物）：主进程从
  // userData/xiangwo-orb-avatar.{png,gif,webp} 或 xiangwo-orb-avatar.json 读；没有就用内置「项」。
  try {
    const avatarUrl = await api.floating.avatarUrl();
    if (typeof avatarUrl === 'string' && avatarUrl !== '') {
      ballAvatar.src = avatarUrl;
      ballAvatar.hidden = false;
      document.body.classList.add('has-avatar');
    }
  } catch {
    /* 读不到头像就保持内置「项」 */
  }
  wireSelectionBar();
  wireDropTarget();
  // [XG-CUSTOM] 上游这里用 backend.subscribe 等 dsh 就绪；我们的 8900 通道是直连，
  // 只在启动时确认一次后端状态，失败也不卡 UI（发消息时会自然报错）。
  try {
    const backend = await api.backend.status();
    status.textContent = backend?.state === 'ready' ? '' : '（项我后端未就绪）';
  } catch {
    status.textContent = '（项我后端未就绪）';
  }
}

void main();
