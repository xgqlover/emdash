// [XG-CUSTOM 2026-10-05] 动作块（球指挥主界面：`[XG-ACTION]`→ host.runCommand；协议见 ./xiangwo-action.ts）
import {
  actionFailureText,
  openXiangwoUrls,
  parseXiangwoActionBlock,
  parseXiangwoOpenUrlBlock,
  runXiangwoAction,
  stripXiangwoActionBlocks,
  stripXiangwoOpenUrlBlocks,
} from './xiangwo-action';
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
//   6) [XG-CUSTOM] **提问卡协议 xiangwo-question**（补上游被删掉的 `#question`/`.question-card`
//      + `question-pager`，语义照 floating.js renderQuestion/chooseOption/submitPending）：
//      我们的 8900 通道是 OpenAI 兼容纯文本，没有结构化提问消息，所以约定一个 fenced JSON 块。
//      agent 只要在回复里带上（单独成段）——**v2（多问分页 / 多选 / 富选项，推荐用法）**：
//        ```xiangwo-question
//        {"questions":[
//          {"id":"q1","header":"站点","question":"要打开哪个站？","detail":"可多选","multiSelect":true,
//           "options":[{"label":"日亚","description":"日本亚马逊"},{"label":"美亚（推荐）"}]}
//        ],"allowCustom":true}
//        ```
//      **v1（老格式，仍然支持，内部归一化成单问）**：
//        ```xiangwo-question
//        {"title":"要打开哪个站？","options":["日亚","美亚","其他"],"allowCustom":true}
//        ```
//      渲染成一张选项卡：header 小标题 / question 主文案 / detail 副文案 / 选项
//      （多选=checkbox 语义 + `aria-checked` + ✓；单选=radio 语义；`(推荐)`/`（推荐）` 剥成徽标；
//      `description` 小字）/ 自定义输入 / 底部「提交 · 跳过 · 取消」/ 多问时「第 N/M 问 + 上一步/下一步 + 进度」。
//      提交前校验：有没答完的问就跳过去 + 出一句提示（**绝不静默**）。
//      用户答完（或取消）后卡片置为已答态、禁用交互，并把**答案文本**作为一条 user 消息发回去。
//      字段上限：questions ≤8 问；每问 options ≤12 个、每项文字 ≤120 字（问句/副文案 ≤200）；
//      header/question 至少给一个；allowCustom 选填（默认 true）；multiSelect 选填（默认单选）。
//      [XG-CUSTOM 2026-10-05] 另支持两个字段（照 assistant-ui `option-list.tsx` 的语义，**抄语义不引库**）：
//        · `maxSelections`：多选上限（缺省/0 = 不限）。到顶后再点新选项 → 忽略 + 提示"最多选 N 项"（不静默）。
//        · `defaultValue`（别名 `default` / `preselect`）：预选项数组（只接受**选项里真有**的 label）。
//          用户**提交过**的卡片会按问题 `id` 记住选择，下次同一 id 自动预选（存 localStorage，不进对话记录）；
//          agent 显式给的 `defaultValue` 优先级高于记忆。
//      解析失败 / 坏 JSON / 一问都没有 → 整段当普通文本渲染（绝不吞消息）。
//      落盘只有 `message.answer` 那段**文本**（没有 DOM、没有草稿结构，见 persistConversations）。
//   6.1) [XG-CUSTOM] **图片协议 xiangwo-images**（治「agent 说已推到侧边栏、用户什么都看不到」）：
//      图搜/素材工具原来只回 `[XG-PREVIEW]<文件服务>?path=/tmp/xxx.html`，而球面板**没有**该预览器、
//      那个 9090 文件服务（HippoBuddy 内置 Java）也没在跑 → 球里永远什么都不显示。
//      现在约定一个 fenced JSON 块，agent 输出它就等于"展示了"：
//        ```xiangwo-images
//        {"title":"baking brush food illustration","images":[{"url":"<可能是相对地址 /xg/img?u=…>",
//          "thumb":"<同上，可选>","alt":"…","source":"searxng","page":"<来源作品页，可选>",
//          "orig":"<原始图片地址，可选>"}]}
//        ```
//      渲染：网格（每格一张图 + 角上来源域名角标，`loading="lazy"` + `referrerpolicy="no-referrer"`
//      防防盗链）。[XG-CUSTOM 2026-10-03] **`url`/`thumb`/`page` 是相对路径时要按 agent 基址拼绝对**
//      （基址 = 主进程解析的 `resolveXiangwoChatUrl().baseUrl`，复用同一套"多候选/隧道/回落"逻辑；
//      见 ./xiangwo-images.ts）—— 第三方 CDN 直链会被防盗链/签名过期干掉，agent 侧改成走自己的
//      `/xg/img?u=…` 代理；拼不出基址 → 该卡「图片不可用」占位，**不让整个网格崩**。
//      [XG-CUSTOM 2026-10-03] **整卡可点**：优先 `page`（来源作品页）→ 没有就什么都不做（不悄悄开
//      系统浏览器）；打开方式 = 主进程 `host.openEmbeddedBrowser`（复用「从零开页」广播 →
//      主窗口 openEmbeddedBrowserTab），**点击后不离开球面板**。角上域名取 `page` 的 host（否则
//      `source`），`title` 属性挂完整 URL。
//      字段：title 选填（≤200 字）；images 必填（≤60 条，每条至少 url/orig/page 之一）。
//      坏 JSON / 一条合法地址都没有 → 整段当普通文本（绝不吞消息）；块本身不残留在气泡文字里。
//      单张图 `onerror` → 只有那**一张**退化成「文字 + 域名」（可点），别的卡不受影响。
//      **历史里只落前 24 条地址**，不落 dataURL（见 ./xiangwo-images.ts 的 compactXiangwoImagesBlock
//      与 persistConversations）。
//   7) [XG-CUSTOM] **划词工具条（范围内版）**：只在球面板内部选中文字时弹出
//      「搜索 / 翻译 / 发给项我」。三个动作都是**立刻可见**的：搜索 → 系统浏览器打开搜索结果；
//      翻译 → 把「把下面这段翻译成中文：\n<选中>」**当场作为一条消息发出去**（不是只填进输入框）；
//      发给项我 → 把选中文字当场发出去。动作绑在 mousedown（防"按下即折叠选区 → 条被隐藏 → 点空"）。
//      全局版（任意应用选中 → 快捷键唤起）见文件末尾 TODO
//      （Linux 需要 xdotool/xclip + 全局快捷键，属系统级依赖，先不做）。
//   8) [XG-CUSTOM] 明确**不做**（写明原因，避免以后当成漏做）：
//      - 上游的 `dsh-app://` 自定义协议 / iframe 嵌 dsh 转录 → 我们直接用 8900 直连 + 自己渲染气泡；
//      - 上游的选区芯片 / macOS TCC 授权门 → macOS/Win 专属，Linux 无此概念（主进程侧保持 no-op）。
//   9) [XG-CUSTOM 2026-10-05] **SSE 流式接收 + 放宽耐心**（治 `调用失败: Failed to fetch`）：
//      8900 一轮可能 69 秒（LLM 慢 + 工具循环 + 交接台 15 秒超时）且**期间零字节**，旧代码
//      "总共 10 秒重试窗口"盖不住 → 连接被中间层掐断 → 用户只看到 Failed to fetch。
//      现在：请求带 `stream:true`，`streamXiangwoChat`（./xiangwo-chat.ts）逐块解析 SSE、
//      **边收边渲染**（delta.content 直接追加到当前 assistant 气泡，见 paintStreamingBubble）、
//      delta.status/空 content 心跳进状态区；耐心改成"首字节 20 秒 + 流内空闲 90 秒"；
//      非 SSE 响应 → 整段渲染；中途断流 → 保留部分内容 + 标注；只有 0 字节才算失败。
//      重试**只**发生在连接建立阶段（首字节之前），进流之后绝不整轮重发（避免重复开网页/重复点按钮）。
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
// [XG-CUSTOM] 聊天通道工具（地址解析 + SSE 流式接收）在 ./xiangwo-chat.ts 里 —— 球和旧浮窗共用一份，
// 并且能被 vitest 直接单测；构建后会被打进本 bundle（harness 断言跑的就是产物）。
import {
  interruptedNoteText,
  resolveXiangwoChatUrl,
  retryStatusText,
  streamFailureText,
  streamXiangwoChat,
  waitingStatusText,
  XIANGWO_HEARTBEAT_STATUS,
} from './xiangwo-chat';
// [XG-CUSTOM 2026-10-04] 侧边枝历史「拉回」：球重开/换机器后从后端把对话取回来。
// （后端 `/sidebar/history` 一直有、侧边枝一直在落盘，但前端**从没调用过** →
//  会话只活在 localStorage，清缓存/换机就没了 = 用户说的「侧边也没有重新记忆」）
import { buildSidebarHistoryUrl, fetchSidebarHistory, historyToMessages } from './xiangwo-history';
// [XG-CUSTOM 2026-10-03] 图片协议 xiangwo-images 的解析/渲染整体挪进 ./xiangwo-images.ts
// （相对地址按 agent 基址拼绝对 + 整卡点击走内嵌浏览器 + 单卡加载失败退化）：纯逻辑 + DOM
// 都能被 vitest 直接断言（见 xiangwo-images.test.ts），这里只保留"接线"。
import {
  compactXiangwoImagesBlock,
  parseXiangwoImagesBlock,
  renderXiangwoImageGrid,
} from './xiangwo-images';
// [XG-CUSTOM 2026-10-05] MCP 工具市场卡（协议 xiangwo-mcp；解析/渲染/过滤见 ./xiangwo-mcp.ts）
import { parseXiangwoMcpBlock, renderXiangwoMcpMarket } from './xiangwo-mcp';

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
 * [XG-CUSTOM] **边缘停靠（dock）**：细条被悬停这么久（ms）就滑回球态
 * （照上游 floating.js 的 DOCK_HOVER_DELAY_MS；滑回动画 300ms easeOutCubic 在主进程做）。
 */
const DOCK_HOVER_DELAY_MS = 800;
/**
 * [XG-CUSTOM] **边缘停靠**：拖着细条朝屏幕内侧移超过这么多 DIP 就解锁
 * （照上游 floating.js 的 DOCK_DRAG_OFF_PX = 24 = 球宽/3，与主进程 ORB_DOCK_DRAG_OFF 同值）。
 */
const DOCK_DRAG_OFF_PX = 24;
/**
 * [XG-CUSTOM 2026-10-04] 从后端拉回侧边枝历史的超时（ms）。
 * 球常驻、拉历史是"锦上添花"，所以给一个短超时：宁可这次没恢复，也绝不因为
 * 远端主机 SSH 隧道慢而让切 bot 卡住。失败静默（下次切回来再拉一次）。
 */
const HISTORY_RESTORE_TIMEOUT_MS = 8000;
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
    // [XG-CUSTOM] 模型目录：启动时读一次拿 `current`（send() 带进请求体）。
    // 目录里 `supported:false`（实测 8900 不支持选模型）—— 渲染侧只**读**不写，
    // 写入口在右键菜单的主进程侧（选项 disabled）。
    modelCatalog: () => orbApi('floating.modelCatalog', {}),
    avatarUrl: () => orbApi('floating.avatarUrl', {}),
    // [XG-CUSTOM] 划词工具条开关（落盘布尔，默认开 = 与现状一致）：启动时读一次决定
    // 要不要 wireSelectionBar()。改它只走右键菜单（主进程落盘后回传新值）。
    selectionToolbar: () => orbApi('floating.selectionToolbar', {}),
    orbWorkspacePath: () => orbApi('floating.orbWorkspacePath', {}),
    relaunch: () => orbApi('floating.relaunch', {}),
    tccStatus: () => orbApi('floating.tccStatus', {}),
    openTcc: (right) => orbApi('floating.openTcc', { right }),
    // [XG-CUSTOM] 右键菜单：主进程弹原生菜单，返回 `{action, avatarChanged?, message?, selectionEnabled?}`。
    // 带上 editState（焦点是否可编辑 + 剪贴板动作可用性）→ 主进程在菜单顶部插 cut/copy/paste。
    contextMenu: (editState) => orbApi('floating.contextMenu', editState ?? {}),
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
        : [
            Math.round(panel.getBoundingClientRect().width),
            Math.round(panel.getBoundingClientRect().height),
          ],
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

// [XG-CUSTOM] 提问卡协议 v2 的硬上限（与 agent 侧 xiangwo_question_block 一致）
const QUESTION_MAX_QUESTIONS = 8;
const QUESTION_MAX_OPTIONS = 12;
const QUESTION_TEXT_MAX = 200; // question / detail / title
const QUESTION_ITEM_MAX = 120; // header / 选项文字 / 选项说明
const QUESTION_ID_MAX = 40;
// [XG-CUSTOM 2026-10-05] 提问卡"记住上次选择"的存储（localStorage，按问题 id 存）
const QUESTION_MEMORY_KEY = 'xg-question-memory';
const QUESTION_MEMORY_MAX = 60;

// 「(推荐)」后缀正则 —— **照抄上游** floating.js:9 的 RECOMMENDED_SUFFIX
// （半角 `(推荐)`/`(recommended)` 与全角 `（推荐）`/`（recommended）` 都认，只认结尾）。
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;

/**
 * [XG-CUSTOM] 「(推荐)」后缀 → 徽标（上游 floating.js:76 parseRecommendedLabel 的等价物）。
 * @param {string} label 原始选项文字
 * @returns {{ label: string, recommended: boolean }} 剥掉后缀的文字 + 是否推荐
 */
function parseRecommendedLabel(label) {
  const text = typeof label === 'string' ? label : '';
  return RECOMMENDED_SUFFIX.test(text)
    ? { label: text.replace(RECOMMENDED_SUFFIX, '').trim(), recommended: true }
    : { label: text, recommended: false };
}

/**
 * [XG-CUSTOM] 归一化一个选项：字符串或 `{label, description}`。
 * 没有有效文字 → undefined（调用方丢掉这一项）。
 * @param {unknown} raw 原始选项
 * @returns {{ label: string, recommended: boolean, description: string } | undefined}
 */
function normalizeQuestionOption(raw) {
  const rawLabel = typeof raw === 'string' ? raw : typeof raw?.label === 'string' ? raw.label : '';
  const label = rawLabel.trim();
  if (label === '') return undefined;
  const display = parseRecommendedLabel(label.slice(0, QUESTION_ITEM_MAX));
  const rawDescription = typeof raw?.description === 'string' ? raw.description : '';
  return {
    label: display.label,
    recommended: display.recommended,
    description: rawDescription.trim().slice(0, QUESTION_ITEM_MAX),
  };
}

/**
 * [XG-CUSTOM] 归一化一问（`header` / `question` 至少有一个，否则 undefined）。
 * @param {unknown} raw 原始一问
 * @param {number} index 序号（补 `id` 用）
 * @returns {{ id: string, header: string, question: string, detail: string, multiSelect: boolean,
 *            options: Array<{label: string, recommended: boolean, description: string}> } | undefined}
 */
function normalizeQuestion(raw, index) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const header = (typeof raw.header === 'string' ? raw.header.trim() : '').slice(
    0,
    QUESTION_ITEM_MAX
  );
  const question = (typeof raw.question === 'string' ? raw.question.trim() : '').slice(
    0,
    QUESTION_TEXT_MAX
  );
  if (header === '' && question === '') return undefined;
  const detail = (typeof raw.detail === 'string' ? raw.detail.trim() : '').slice(
    0,
    QUESTION_TEXT_MAX
  );
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const options = [];
  if (Array.isArray(raw.options)) {
    for (const candidate of raw.options) {
      const option = normalizeQuestionOption(candidate);
      if (option === undefined) continue;
      options.push(option);
      if (options.length >= QUESTION_MAX_OPTIONS) break;
    }
  }
  // [XG-CUSTOM 2026-10-05] 补两个来自 assistant-ui `option-list.tsx` 的语义（照抄语义，不引库）：
  //   · `maxSelections`：多选上限（缺省/0 = 不限）；
  //   · `defaultValue`（别名 `default` / `preselect`）：预选项 —— 用来"记忆上次选择"或让 agent 指定推荐组合。
  // 预选项**只接受确实存在于 options 里的 label**（否则脏数据会把不存在的选项标成已选）。
  const maxSelections =
    Number.isFinite(raw.maxSelections) && raw.maxSelections > 0
      ? Math.min(Math.floor(raw.maxSelections), Math.max(1, options.length))
      : 0;
  const preselect = [];
  const candidates = Array.isArray(raw.defaultValue ?? raw.default ?? raw.preselect)
    ? (raw.defaultValue ?? raw.default ?? raw.preselect)
    : [raw.defaultValue ?? raw.default ?? raw.preselect];
  for (const candidate of candidates) {
    const label = typeof candidate === 'string' ? candidate.trim() : '';
    if (label === '' || preselect.includes(label)) continue;
    if (!options.some((option) => option.label === label)) continue;
    preselect.push(label);
  }
  const cappedPreselect =
    raw.multiSelect === true
      ? maxSelections > 0
        ? preselect.slice(0, maxSelections)
        : preselect
      : preselect.slice(0, 1);
  return {
    id: rawId === '' ? `q${String(index + 1)}` : rawId.slice(0, QUESTION_ID_MAX),
    header,
    // `question` 是主文案；只给了 header 时用它顶（否则卡上会一片空）
    question: question === '' ? header : question,
    detail,
    multiSelect: raw.multiSelect === true,
    maxSelections,
    preselect: cappedPreselect,
    options,
  };
}

/**
 * [XG-CUSTOM] 解析回复里的提问块（协议见文件头 6)）。
 * 新格式 `{questions:[...], allowCustom?}`；老格式 `{title, options:[string]}` 归一化成"单问"。
 * 找不到 / JSON 坏了 / 一问都没有 → 原样返回文本、question = undefined（绝不吞消息）。
 * @param {string} text 助手回复原文
 * @returns {{ text: string, question?: { questions: Array<object>, allowCustom: boolean } }}
 */
function parseQuestionBlock(text) {
  const match = /```xiangwo-question\s*([\s\S]*?)```/.exec(text);
  if (match === null) return { text };
  try {
    const raw = JSON.parse(match[1].trim());
    const allowCustom = raw?.allowCustom !== false;
    const questions = [];
    if (Array.isArray(raw?.questions)) {
      for (const item of raw.questions) {
        const question = normalizeQuestion(item, questions.length);
        if (question === undefined) continue;
        questions.push(question);
        if (questions.length >= QUESTION_MAX_QUESTIONS) break;
      }
    }
    if (questions.length === 0) {
      // 老格式（v1）：{title, options:[string]} —— 内部归一化成单问，渲染路径只有一条
      const legacy = normalizeQuestion({ question: raw?.title, options: raw?.options }, 0);
      if (legacy === undefined) return { text };
      questions.push(legacy);
    }
    const cleaned = text.replace(match[0], '').trim();
    return { text: cleaned, question: { questions, allowCustom } };
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
// [XG-CUSTOM 2026-10-03] 历史里每个图片块最多落盘多少条地址（前 24 条，省 localStorage）不再在这里
// 定义：协议/落盘压缩都归 ./xiangwo-images.ts（XIANGWO_IMAGES_STORE_MAX，与 xiangwo-images.test.ts 同一份）。

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
  // [XG-CUSTOM] 面板选项行的「工作区只读芯片」（只显示 basename，title 给全路径）
  const workspaceChip = document.querySelector('#workspace-chip');
  // [XG-CUSTOM] 边缘停靠的 6px 细条（orb.html 里自带 hidden，停靠时点亮）
  const dockTab = document.querySelector('#dock-tab');

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
  // [XG-CUSTOM] 当前真实路由标识（`floating.overlayModel()`；启动时读一次，send() 带进请求体）。
  // 空串 = 还没读到，请求体里就不放 model 字段（不为空值瞎填）。
  let overlayModelLabel = '';
  // [XG-CUSTOM] 划词工具条开关（主进程落盘布尔；启动时读一次，决定要不要 wireSelectionBar）。
  // 默认 true = 与老行为一致（读不到开关就不改变现状）。
  let selectionToolbarEnabled = true;
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
  // [XG-CUSTOM] 边缘停靠状态。主进程是唯一权威（move/clamp/unsnap 的返回 + xiangwo:orb-mode 事件），
  // 这里只做镜像：docked = 'left' | 'right' | undefined。
  let docked;
  let dockHoverTimer;
  /** 停靠后的 800ms 内先"不武装"悬停，避免刚吸上就被自己那一下 pointerenter 立刻弹回来 */
  let dockHoverArmed = true;
  let dockPointerInside = false;
  /** [XG-CUSTOM] 拖细条的手势状态（{ startX, startY, moved }）；内移 > 24px 就解锁 */
  let dockDrag;
  /** [XG-CUSTOM] "本该吸边却被拒"提示的计时器（见 notifyDockRefused） */
  let dockRefusedTimer;
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
        // [XG-CUSTOM] 图片网格块落盘时只留前 N 条地址（**不落 dataURL**，见 compactXiangwoImagesBlock）
        text: compactXiangwoImagesBlock(message.text),
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
    // [XG-CUSTOM 2026-10-04] 切到该 bot 后（且本地没内容时）从后端拉回侧边枝历史
    await restoreFromBackend(nextBotId);
  }

  /**
   * [XG-CUSTOM 2026-10-04] 这个 bot 在本地有没有「有内容」的会话。
   *
   * 只看 messages 非空 —— `startConversation()` 会把一条**空**会话立刻写进桶，
   * 所以「桶里有没有条目」不能当判据（否则换机器时永远判成"本地已有"，永远不恢复）。
   */
  function hasLocalMessages(botId) {
    return loadBucket(botId).some(
      (item) => Array.isArray(item.messages) && item.messages.length > 0
    );
  }

  /**
   * [XG-CUSTOM 2026-10-04] 从后端把该 bot 的侧边枝历史拉回来（清缓存/换机器后接着聊）。
   *
   * 规则（保守优先，宁可少恢复也不覆盖）：
   *   ① 本地已有消息 → 什么都不做（本地是权威，绝不覆盖用户看得见的对话）
   *   ② 默认 bot（空串「项我」）→ 直接跳过：后端没有它的侧边枝
   *      （`_suagent_log_turn` 取 `_sidebar_branch_ids.get('')` 取不到 → 直接 return），
   *      见 `sidebar-agent/OPS.md` §2026-10-04
   *   ③ 拉到的历史为空 / 拉取失败 → 什么都不做：不提示、不打断、不崩
   *   ④ 拉的期间用户切走了 / 已经开始聊了 → 丢弃本次结果
   *
   * 每一步都留 trace（照 `history-migrated` 的惯例）——拉历史是异步且"静默成功"的，
   * 没有 trace 就只能靠肉眼读面板状态，排查"为什么没恢复"会很痛。
   */
  async function restoreFromBackend(botId) {
    if (botId === '') return;
    if (hasLocalMessages(botId)) {
      trace('history-restore-skip', { bot: botId, reason: 'local-messages' });
      return;
    }
    // 基址优先用已经解析好的（图片网格那条路）；没有就问一次主进程
    const target = agentBaseUrl === '' ? await chatEndpoint().catch(() => undefined) : undefined;
    const url = buildSidebarHistoryUrl(
      agentBaseUrl !== '' ? agentBaseUrl : (target?.baseUrl ?? ''),
      botId
    );
    if (url === '') {
      trace('history-restore-skip', { bot: botId, reason: 'no-agent-base' });
      return;
    }
    const history = await fetchSidebarHistory({
      url,
      signal: AbortSignal.timeout(HISTORY_RESTORE_TIMEOUT_MS),
    });
    if (history === undefined || history.messages.length === 0) {
      trace('history-restore-skip', { bot: botId, reason: 'empty-or-failed' });
      return;
    }
    if (currentBotId !== botId || hasLocalMessages(botId)) {
      trace('history-restore-skip', { bot: botId, reason: 'switched-or-started' });
      return;
    }
    current = {
      id: newId(),
      title: history.title !== '' ? history.title : '（已从后端拉回）',
      messages: historyToMessages(history),
    };
    conversations = [current];
    saveBucket(botId, conversations);
    renderHistory();
    renderTranscript();
    await api.floating.setSessionId(current.id);
    status.textContent = `已从后端拉回 ${current.messages.length} 条侧边历史`;
    trace('history-restored', { bot: botId, messages: current.messages.length });
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
      // [XG-CUSTOM] 也可能带图片网格块（协议见文件头 6.1)）→ 先拆图片块，再在剩下的文字里找提问块
      const withImages =
        message.role === 'assistant'
          ? parseXiangwoImagesBlock(message.text ?? '')
          : { text: message.text ?? '' };
      const withMcp =
        message.role === 'assistant'
          ? parseXiangwoMcpBlock(withImages.text)
          : { text: withImages.text };
      // [XG-CUSTOM 2026-10-05] 动作块：**先取出动作、把块从正文去掉**，再交给提问卡解析
      const actions = message.role === 'assistant' ? parseXiangwoActionBlock(withMcp.text) : [];
      const withAction =
        message.role === 'assistant'
          ? { text: stripXiangwoActionBlocks(withMcp.text) }
          : { text: withMcp.text };
      // [XG-CUSTOM 2026-10-05] `xiangwo-open-url` 块（方案 A）：让 emdash 主界面开网页 ——
      //   **复用已注入的 `host.openEmbeddedBrowser`**（bootstrap 里 configureOrbEmbeddedBrowserOpen），
      //   所以不需要 boot 注入 hostCommands、也不动白名单。解析完把块从正文去掉。
      const openUrls =
        message.role === 'assistant' ? parseXiangwoOpenUrlBlock(withAction.text) : [];
      const withOpen =
        message.role === 'assistant'
          ? { text: stripXiangwoOpenUrlBlocks(withAction.text) }
          : { text: withAction.text };
      const parsed =
        message.role === 'assistant' ? parseQuestionBlock(withOpen.text) : { text: withOpen.text };
      if (parsed.text !== '' || message.streaming === true) {
        const bubble = document.createElement('div');
        bubble.className = 'transcript-bubble';
        bubble.textContent = parsed.text;
        row.append(bubble);
      }
      if (withImages.images !== undefined) {
        // [XG-CUSTOM 2026-10-03] 图片网格：相对地址按 agent 基址拼绝对 + 整卡点击开内嵌浏览器
        // （渲染/降级细节见 ./xiangwo-images.ts；这里只把当前基址/bot/桥接进去）
        row.append(
          renderXiangwoImageGrid(document, withImages.images, {
            baseUrl: agentBaseUrl,
            botId: currentBotId,
            bridge,
          })
        );
      }
      if (withMcp.market !== undefined) {
        // [XG-CUSTOM 2026-10-05] MCP 工具市场：服务器卡 + 健康徽标 + 写类标记 + 分面过滤
        renderXiangwoMcpMarket(document, withMcp.market, {
          // [XG-CUSTOM 2026-10-05] 卡片上的「重新体检」按钮 → 发一条消息让 agent 现场枚举（probe=true）
          onAction: (text) => void send(text),
        });
      }
      if (parsed.question !== undefined) {
        row.append(renderQuestionCard(message, parsed.question));
      }
      // [XG-CUSTOM 2026-10-05] 执行动作（best-effort）：成功不吵；**失败如实说一句**（不假装成功）
      //   白名单在**主进程**判（`host.runCommand`），球侧只负责发与回报 —— 见 ./xiangwo-action.ts
      // [XG-CUSTOM] 2026-10-06 例外：`host.openEmbeddedBrowser`（开网页）**不查白名单**，走
      //   xiangwo-action.ts 的直连表 → 同一个 `bridge.orbApi`。这里不用改，路由在那边判。
      if (openUrls.length > 0) {
        // [XG-CUSTOM 2026-10-05] 让主界面开页：成功不吵；**失败如实说**（不假装开好了）
        void openXiangwoUrls(openUrls, (method, payload) => {
          const call = bridge.orbApi;
          return typeof call === 'function'
            ? call(method, payload)
            : { ok: false, reason: 'unavailable' };
        }).then((result) => {
          if (result.ok) return;
          const notice = document.createElement('div');
          notice.className = 'transcript-action-notice';
          notice.textContent =
            result.reason === 'unavailable'
              ? '这条开页通道没接上（你那边没有可用的内嵌浏览器），我没能帮你把页面打开。'
              : `有页面没打开成功：${result.message ?? ''}`;
          row.append(notice);
          transcript.scrollTop = transcript.scrollHeight;
        });
      }
      for (const action of actions) {
        void runXiangwoAction(action, (method, payload) => {
          const call = bridge.orbApi;
          return typeof call === 'function'
            ? call(method, payload)
            : { ok: false, reason: 'unavailable' };
        }).then((result) => {
          if (result.ok) return;
          const notice = document.createElement('div');
          notice.className = 'transcript-action-notice';
          notice.textContent = actionFailureText(action, result);
          row.append(notice);
          transcript.scrollTop = transcript.scrollHeight;
        });
      }
      transcript.append(row);
    }
    transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * [XG-CUSTOM] 提问卡的临时草稿（一问一条：选中项 / 自定义输入 / 是否跳过）。
   * **不落盘**：DOM 每次重渲染都会重建，草稿挂回消息对象（WeakMap）才不会丢；
   * 落盘的只有最终那条 `message.answer` 文本（见 persistConversations）。
   */
  const questionDrafts = new WeakMap();

  /** 取（没有就建）某条助手消息的草稿数组；问题数变了就重建（协议变了/历史重载） */
  // [XG-CUSTOM 2026-10-05] 「记住上次选择」：按**问题 id** 记住上次勾了什么，下次同一 id 的卡片自动预选
  // （照 assistant-ui `option-list.tsx` 的 `defaultValue` 语义）。存 localStorage —— 球自己的 webContents、
  // 跟 profile 走；不落主进程文件、不进对话记录。失败（隐私模式/配额）就当没记忆，不影响作答。
  function readQuestionMemory() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(QUESTION_MEMORY_KEY) ?? '{}');
      return raw !== null && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function rememberQuestionChoice(id, selected) {
    if (typeof id !== 'string' || id === '' || !Array.isArray(selected) || selected.length === 0) {
      return;
    }
    try {
      const memory = readQuestionMemory();
      memory[id] = selected.slice(0, QUESTION_MAX_OPTIONS);
      const keys = Object.keys(memory);
      for (const stale of keys.slice(0, Math.max(0, keys.length - QUESTION_MEMORY_MAX))) {
        delete memory[stale];
      }
      window.localStorage.setItem(QUESTION_MEMORY_KEY, JSON.stringify(memory));
    } catch {
      /* 隐私模式/配额满：记忆失败不影响作答 */
    }
  }

  function draftState(message, questions) {
    let drafts = questionDrafts.get(message);
    if (!Array.isArray(drafts) || drafts.length !== questions.length) {
      const memory = readQuestionMemory();
      drafts = questions.map((item) => {
        // 优先级：agent 显式给的 preselect > 上次的选择；两者都过滤成"选项里真有的"并受 maxSelections 约束
        const wanted = item.preselect.length > 0 ? item.preselect : (memory[item.id] ?? []);
        const valid = (Array.isArray(wanted) ? wanted : []).filter(
          (label) =>
            typeof label === 'string' && item.options.some((option) => option.label === label)
        );
        const capped = item.multiSelect
          ? item.maxSelections > 0
            ? valid.slice(0, item.maxSelections)
            : valid
          : valid.slice(0, 1);
        return { selected: capped, custom: '', skipped: false };
      });
      questionDrafts.set(message, drafts);
    }
    return drafts;
  }

  /** 这一问答了吗（选了选项 或 自己写了答案）—— `asking()` 与提交校验共用 */
  function draftAnswered(draft) {
    return draft.selected.length > 0 || draft.custom.trim() !== '';
  }

  /** 这一问算"处理过了"吗（答了 或 跳过了）—— 提交校验用 */
  function draftCompleted(draft) {
    return draftAnswered(draft) || draft.skipped;
  }

  /**
   * [XG-CUSTOM] 把草稿拼成**一条 user 消息文本**（落盘的也只有这段文字，没有 DOM/结构）。
   * 单问（含老格式 v1）：答案就是选项文字，保持「已答：日亚」的老行为。
   * 多问：一行一问 `标题：答案`，多选用 `、` 连接，跳过写「（跳过）」。
   * @param {Array<object>} questions 归一化后的问题
   * @param {Array<{selected: string[], custom: string, skipped: boolean}>} drafts 草稿
   * @returns {string} 要发出去（并落盘）的答案文本
   */
  function composeQuestionAnswer(questions, drafts) {
    const values = questions.map((item, index) => {
      const draft = drafts[index];
      if (draft.skipped) return '（跳过）';
      const parts = [...draft.selected];
      const custom = draft.custom.trim();
      if (custom !== '') parts.push(custom);
      return parts.length === 0 ? '（跳过）' : parts.join('、');
    });
    if (questions.length === 1) return values[0];
    return questions
      .map((item, index) => {
        // 有 header 用 header；没有就用问句本身（去掉结尾的问号/冒号，别拼出「…？：」）
        const label = item.header !== '' ? item.header : item.question.replace(/[？?：:]\s*$/, '');
        return `${label}：${values[index]}`;
      })
      .join('\n');
  }

  /**
   * [XG-CUSTOM] 渲染一张选项卡（上游 `#question`/`.question-card` + `question-pager` 的等价物）。
   *
   * 交互（照上游 floating.js renderQuestion / chooseOption / submitPending / skipQuestion / cancelQuestion）：
   * - 选项：单选=radio 语义（点了自动翻到下一问）；多选=checkbox 语义（`aria-checked` + ✓ 可反复勾/取消）
   * - 分页：第 N/M 问 + 上一步/下一步 + 进度条（只有一问时整条隐藏）
   * - 底部：提交 / 跳过 / 取消。**未答完就提交** → 跳到缺的那一问 + 出校验提示（绝不静默）
   * - 答完（或取消）→ 卡片置为已答态：所有交互禁用 + 一行「已答：…」，并把答案文本落进历史
   *
   * @param {object} message 所属助手消息（`message.answer` 记录已答文本，随历史落盘）
   * @param {{questions: Array<object>, allowCustom: boolean}} question 解析/归一化出来的提问
   * @returns {HTMLElement} 卡片元素
   */
  function renderQuestionCard(message, question) {
    const card = document.createElement('div');
    card.className = 'question-card';
    const questions = question.questions;
    const answered = typeof message.answer === 'string' && message.answer !== '';
    const answeredText = answered ? message.answer : '';
    const drafts = answered
      ? questions.map(() => ({ selected: [], custom: '', skipped: true }))
      : draftState(message, questions);
    let index = 0; // 当前第几问（多问分页）
    let error = ''; // 校验提示（未答完提交时出人话）

    /** 收尾：写答案文本（**只落文本**）→ 重渲染成已答态；skipSend=true 用于「取消」 */
    const commit = (value, skipSend) => {
      if (answered) return;
      message.answer = value;
      persistConversations();
      renderTranscript();
      if (skipSend !== true) void send(value);
    };

    /** 提交：先校验"每一问都答了或跳过了"，缺就跳过去 + 出提示（绝不静默） */
    const submitAll = () => {
      const missing = drafts.findIndex((draft) => !draftCompleted(draft));
      if (missing >= 0) {
        index = missing;
        error = `第 ${String(missing + 1)} 问还没回答（选一个选项，或点「跳过」）`;
        paint();
        return;
      }
      // [XG-CUSTOM 2026-10-05] 记住这次的选择（下次同一问题 id 的卡片自动预选；照 assistant-ui defaultValue 语义）
      questions.forEach((item, order) => {
        rememberQuestionChoice(item.id, drafts[order]?.selected ?? []);
      });
      const text = composeQuestionAnswer(questions, drafts);
      trace('question-submit', { count: questions.length, text });
      commit(text, false);
    };

    /** 把"第 index 问"的画到卡里。interactive=false = 已答态（全部禁用） */
    const appendQuestion = (item, draft, interactive) => {
      if (item.header !== '') {
        const header = document.createElement('div');
        header.className = 'question-header';
        header.textContent = item.header;
        card.append(header);
      }
      const title = document.createElement('div');
      title.className = 'question-title';
      title.textContent = item.question;
      card.append(title);
      if (item.detail !== '') {
        const detail = document.createElement('div');
        detail.className = 'question-detail';
        detail.textContent = item.detail;
        card.append(detail);
      }
      if (item.options.length > 0) {
        const list = document.createElement('div');
        list.className = 'question-options';
        list.setAttribute('role', item.multiSelect ? 'group' : 'radiogroup');
        for (const [optionIndex, option] of item.options.entries()) {
          const chosen = interactive
            ? draft.selected.includes(option.label)
            : answeredText.includes(option.label);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = chosen ? 'question-option chosen' : 'question-option';
          button.setAttribute('role', item.multiSelect ? 'checkbox' : 'radio');
          button.setAttribute('aria-checked', String(chosen));
          button.setAttribute('aria-label', option.label);
          button.disabled = !interactive;
          const copy = document.createElement('span');
          copy.className = 'question-option-copy';
          const label = document.createElement('span');
          label.className = 'question-option-label';
          label.textContent = option.label;
          copy.append(label);
          if (option.recommended) {
            const badge = document.createElement('span');
            badge.className = 'question-recommended';
            badge.textContent = '推荐';
            copy.append(badge);
          }
          if (option.description !== '') {
            const description = document.createElement('span');
            description.className = 'question-option-description';
            description.textContent = option.description;
            copy.append(description);
          }
          // [XG-CUSTOM] 多选（或分页多问）才把序号/✓ 画出来；单问单选保持 v1 的纯文字 chip
          const showMark = item.multiSelect || questions.length > 1;
          if (showMark) {
            const mark = document.createElement('span');
            mark.className = 'question-option-mark';
            mark.textContent = item.multiSelect ? (chosen ? '✓' : '') : String(optionIndex + 1);
            button.append(mark);
          }
          button.append(copy);
          if (interactive) {
            button.addEventListener('click', () => {
              if (item.multiSelect) {
                // [XG-CUSTOM 2026-10-05] maxSelections 上限：到顶后**忽略新增**并出人话提示
                // （照 assistant-ui option-list 的 maxSelections；不再静默吞点击）
                if (chosen) {
                  draft.selected = draft.selected.filter((entry) => entry !== option.label);
                } else if (item.maxSelections > 0 && draft.selected.length >= item.maxSelections) {
                  error = `最多选 ${String(item.maxSelections)} 项（先取消一个再选）`;
                  paint();
                  return;
                } else {
                  draft.selected = [...draft.selected, option.label];
                }
              } else {
                draft.selected = [option.label];
                draft.custom = '';
                // [XG-CUSTOM] 单选：还有下一问就自动翻过去（照上游 chooseOption）；
                // **只有一问**时直接收（v1 老行为：点选项 = 答完，用户不用再点提交，
                // 否则老格式会退化成"点了没反应"）。
                if (index < questions.length - 1) index += 1;
              }
              draft.skipped = false;
              error = '';
              paint();
              if (!item.multiSelect && questions.length === 1) submitAll();
            });
          }
          list.append(button);
        }
        card.append(list);
      }
      // 自定义输入：只画当前问（照上游的单个 question-custom）
      if (interactive && question.allowCustom) {
        const wrap = document.createElement('div');
        wrap.className = 'question-custom';
        const input = document.createElement('textarea');
        input.className = 'question-custom-input';
        input.rows = 1;
        input.placeholder = '或者自己写一个答案…';
        input.value = draft.custom;
        input.addEventListener('input', () => {
          draft.custom = input.value;
          draft.skipped = false;
          if (error !== '') {
            error = '';
            paint();
          }
        });
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.shiftKey) return;
          event.preventDefault();
          if (questions.length === 1) submitAll();
        });
        wrap.append(input);
        card.append(wrap);
      }
    };

    /** 重画整张卡（清空重来；index/error/drafts 都在闭包里，重画不丢） */
    function paint() {
      card.replaceChildren();
      const interactive = !answered;
      const shown = interactive ? [index] : questions.map((_, i) => i);
      for (const questionIndex of shown) {
        appendQuestion(questions[questionIndex], drafts[questionIndex], interactive);
      }
      if (error !== '') {
        const line = document.createElement('p');
        line.className = 'question-error';
        line.setAttribute('role', 'status');
        line.textContent = error;
        card.append(line);
      }
      if (!interactive) {
        const done = document.createElement('div');
        done.className = 'question-answered';
        done.textContent = `已答：${answeredText}`;
        card.append(done);
        return;
      }
      const footer = document.createElement('footer');
      footer.className = 'question-footer';
      if (questions.length > 1) {
        const pager = document.createElement('div');
        pager.className = 'question-pager';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'question-nav question-prev';
        prev.setAttribute('aria-label', '上一问');
        prev.textContent = '上一步';
        prev.disabled = index === 0;
        prev.addEventListener('click', () => {
          if (index === 0) return;
          index -= 1;
          error = '';
          paint();
        });
        const progress = document.createElement('span');
        progress.className = 'question-progress';
        progress.textContent = `${String(index + 1)} / ${String(questions.length)}`;
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'question-nav question-next';
        next.setAttribute('aria-label', '下一问');
        next.textContent = '下一步';
        next.disabled = index === questions.length - 1;
        next.addEventListener('click', () => {
          if (index >= questions.length - 1) return;
          index += 1;
          error = '';
          paint();
        });
        const track = document.createElement('div');
        track.className = 'question-progress-track';
        const fill = document.createElement('div');
        fill.className = 'question-progress-fill';
        fill.style.width = `${String(Math.round(((index + 1) / questions.length) * 100))}%`;
        track.append(fill);
        pager.append(prev, progress, next, track);
        footer.append(pager);
      }
      const actions = document.createElement('div');
      actions.className = 'question-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'question-action question-cancel';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => {
        trace('question-cancel', { count: questions.length });
        // [XG-CUSTOM] 取消 = 这张卡作废（不发消息给模型，避免把"取消"当成回答）
        commit('（已取消）', true);
      });
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'question-action question-skip';
      skip.textContent = '跳过';
      skip.addEventListener('click', () => {
        drafts[index] = { selected: [], custom: '', skipped: true };
        error = '';
        if (index < questions.length - 1) {
          index += 1;
          paint();
          return;
        }
        submitAll();
      });
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'question-action question-submit';
      submit.textContent = '提交';
      submit.addEventListener('click', () => {
        submitAll();
      });
      actions.append(cancel, skip, submit);
      footer.append(actions);
      card.append(footer);
    }

    paint();
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
    // [XG-CUSTOM] 跑起来了就不许停在屏幕边上（上游 canDock = !(running||asking())）：
    // 已经停靠着就顺手滑回来，否则会话在跑、球却是一条没人管的细条。
    if (running && docked !== undefined) void unsnapDocked();
  }

  // ---------- 边缘停靠（dock）----------
  // 语义（照上游）：拖动松手时球压住屏幕左/右边缘 ≥ 球宽 1/5 → 主进程把窗口滑出屏幕外、
  // 只留 6px 细条；悬停细条 800ms → 滑回球态；拖细条向内 > 24px → 立刻解锁。
  // 这里只维护 UI 镜像（body.docked-* + #dock-tab 的显隐/hover 计时），几何全在主进程。

  /**
   * [XG-CUSTOM] 提问卡待答态（上游 `asking()` 的等价物）：当前会话最后一条助手消息里
   * 有提问块、且**还有没答的问题**。待答时不许停靠 —— 否则用户看不到还等着他回答的那张卡。
   *
   * [XG-CUSTOM] v2 适配：一次回复可以是**多问**（`questions` 数组，一问一页）。
   * 判定语义 = 「任一问还没答（没选选项、也没自己写答案）就算待答」——
   * 多选/分页都只是"怎么答"，不改变"有没有答完"。
   * 老格式 `{title,options}` 被归一化成单问，走的是同一条路（等价于 v1 行为）。
   * @returns {boolean} 有待答的提问卡
   */
  function asking() {
    const last = current.messages[current.messages.length - 1];
    if (last === undefined || last.role !== 'assistant') return false;
    // 已答/已取消/已跳过：整张卡都作废了（`answer` 是唯一的落盘标记）
    if (typeof last.answer === 'string' && last.answer !== '') return false;
    const parsed = parseQuestionBlock(parseXiangwoImagesBlock(last.text ?? '').text);
    if (parsed.question === undefined) return false;
    const drafts = draftState(last, parsed.question.questions);
    return parsed.question.questions.some((_, index) => !draftAnswered(drafts[index]));
  }

  /** [XG-CUSTOM] 现在允许吸边吗（与主进程的 running 护栏叠加，见 dockAllowed） */
  function canDockNow() {
    return !(running || asking());
  }

  function clearDockHoverTimer() {
    if (dockHoverTimer === undefined) return;
    clearTimeout(dockHoverTimer);
    dockHoverTimer = undefined;
  }

  /**
   * [XG-CUSTOM] 切到停靠态/球态（只动 UI）。照上游 applyDocked：
   * 刚吸上就起一个 800ms 计时器，到点了如果指针还在细条上就滑回（"悬停细条 800ms → 滑回"）。
   *
   * [XG-CUSTOM] **幂等**：同一个侧别重复通知要原样返回。主进程会推两次（`orb-drag-end` 的返回值
   * + `xiangwo:orb-mode` 事件），而上游那份 applyDocked 每次都 `clearDockHoverTimer()` ——
   * 第二次进来会把刚起的 800ms 计时器清掉、`dockHoverArmed` 永远停在 false →
   * **细条从此再也不会被悬停唤醒**（自检 B 抓到的真 bug：`/tmp` 里 harness 第一版就是被这个挂住的）。
   * 同一条坑还有第二种走法：武装期内换了停靠侧（left ↔ right）——下面也一并重起计时器。
   * @param {'left' | 'right' | undefined | null} side 主进程给的停靠侧
   */
  function applyDocked(side) {
    const next = side === 'left' || side === 'right' ? side : undefined;
    if (docked === next) {
      // 重复通知：只保证细条的显隐正确，绝不动 800ms 悬停计时器
      if (dockTab !== null) dockTab.hidden = next === undefined;
      return;
    }
    const becameDocked = docked === undefined && next !== undefined;
    docked = next;
    document.body.classList.toggle('docked', next !== undefined);
    document.body.classList.toggle('docked-left', next === 'left');
    document.body.classList.toggle('docked-right', next === 'right');
    clearDockHoverTimer();
    if (next === undefined) {
      if (dockTab !== null) dockTab.hidden = true;
      dockHoverArmed = true;
      return;
    }
    if (dockTab !== null) dockTab.hidden = false;
    // [XG-CUSTOM] 还在"武装期"（刚吸上，或侧别从 left 换到 right）就起/重起 800ms 计时器。
    // 上游只在 becameDocked 时起计时器；侧别变更那条路会把计时器清掉却不重起 →
    // dockHoverArmed 永远停在 false，细条再也不会被悬停唤醒（同一个坑的第二种走法）。
    if (!dockHoverArmed || becameDocked) {
      dockHoverArmed = false;
      dockHoverTimer = setTimeout(() => {
        dockHoverTimer = undefined;
        dockHoverArmed = true;
        if (dockPointerInside) void unsnapDocked();
      }, DOCK_HOVER_DELAY_MS);
    }
  }

  /** [XG-CUSTOM] 主进程返回/事件里的 `docked` 字段 → UI（容忍 null / 老桥不带字段） */
  function applyDockedFrom(result) {
    if (result === undefined || result === null) return;
    if (!('docked' in result)) return;
    applyDocked(result.docked);
  }

  /**
   * [XG-CUSTOM] 「本来已经推到屏幕边、却因为运行中/提问卡待答被拒绝吸边」的可见反馈。
   *
   * 真机复现（2026-10-01）教训：护栏静默拒绝时用户只看到"球弹回屏内"，会直接判定"停靠没做/坏了"。
   * 所以：球闪一圈红内描边（1.6s）+ 状态行一句人话 + trace 落日志（可 grep）。
   */
  function notifyDockRefused() {
    const why = running ? '运行中' : '有提问卡等着回答';
    const hint = `（${why}，先不吸边）`;
    const previous = status.textContent;
    status.textContent = hint;
    document.body.classList.add('dock-refused');
    trace('dock-refused', { running, asking: asking() });
    if (dockRefusedTimer !== undefined) clearTimeout(dockRefusedTimer);
    dockRefusedTimer = setTimeout(() => {
      dockRefusedTimer = undefined;
      document.body.classList.remove('dock-refused');
      if (status.textContent === hint) status.textContent = previous;
    }, 1600);
  }

  /**
   * [XG-CUSTOM] 把一次 move/clamp/unsnap 的返回值落到 UI 上：`docked` → body.docked-*；
   * `dockRefused` → 可见反馈（见 notifyDockRefused）。
   * @param {{docked?: string|null, dockRefused?: boolean}|undefined|null} result 主进程返回值
   */
  function applyDockOutcome(result) {
    applyDockedFrom(result);
    if (result !== undefined && result !== null && result.dockRefused === true) {
      notifyDockRefused();
    }
  }

  /** [XG-CUSTOM] 从停靠细条滑回球态（没停靠就是 no-op）。UI 先乐观切回来，再用主进程结果对账。 */
  async function unsnapDocked() {
    if (docked === undefined) return;
    if (typeof api.floating.unsnap !== 'function') return;
    applyDocked(undefined);
    try {
      applyDockOutcome(await api.floating.unsnap());
    } catch (cause) {
      trace('dock-unsnap-error', { error: describeError(cause) });
    }
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
    trace('open-panel', {
      pinned,
      expanded,
      domVisible: panelVisible(),
      mode: await panelOpenState(),
    });
    if (!pinned) {
      applyPinned(true);
      void bridge.orbTogglePin?.().then((next) => applyPinned(next));
    }
    await setExpanded(true);
  }

  async function closePanel() {
    trace('close-panel', {
      pinned,
      expanded,
      domVisible: panelVisible(),
      mode: await panelOpenState(),
    });
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
   *   例外：[XG-CUSTOM 2026-10-03] 图片网格的相对地址要靠它带的 `baseUrl` 拼绝对，
   *   所以启动时也解析一次（见 main() 末尾的 `void chatEndpoint()`）—— 解析不到就保持空串，
   *   卡片画「图片不可用」，绝不让整个网格崩。
   * - 每次**失败后作废**（见 send 的 catch）：主机换了 / 隧道断了 / 8900 刚重启，
   *   下一条消息会重新解析，不会一直卡在过期的地址上。
   */
  let chatTarget;
  /** [XG-CUSTOM 2026-10-03] 当前 agent 基址（图片网格拼相对地址用；'' = 还没解析出来） */
  let agentBaseUrl = '';

  /**
   * [XG-CUSTOM 2026-10-03] 记下 agent 基址（来源见 xiangwo-chat.ts 的 resolveXiangwoChatUrl）。
   * 基址从"没有"变成具体值（或换了路）时，把那些**画不出图**的网格重画一遍
   * （`.image-grid-needs-base` 是 xiangwo-images.ts 打的标记）；流式进行中不重画
   * ——避免打断边收边渲染，收尾那次 renderTranscript 会用新基址重画。
   */
  function applyAgentBaseUrl(next) {
    const value = typeof next === 'string' ? next : '';
    if (value === agentBaseUrl) return;
    agentBaseUrl = value;
    if (sendAbort === undefined && transcript.querySelector('.image-grid-needs-base') !== null) {
      renderTranscript();
    }
  }

  async function chatEndpoint() {
    if (chatTarget === undefined) chatTarget = await resolveXiangwoChatUrl(bridge);
    applyAgentBaseUrl(chatTarget.baseUrl);
    return chatTarget;
  }

  /**
   * [XG-CUSTOM] 流式的**当前** assistant 气泡（最后一条 assistant 行里的气泡）。
   * 流式增量只改它，不整段重渲染：避免闪烁，也保住提问卡/图片网格已答状态。
   * @returns {HTMLElement | null} 气泡元素（还没渲染出来 → null）
   */
  function streamingBubble() {
    const rows = transcript.querySelectorAll('.transcript-row.assistant');
    const row = rows.length > 0 ? rows[rows.length - 1] : undefined;
    return row === undefined || row === null ? null : row.querySelector('.transcript-bubble');
  }

  /**
   * [XG-CUSTOM] 边收边渲染：一个 delta 就更新一次气泡文字（不整段重渲染）。
   * 气泡不在（空文本被跳过等）→ 退化成整段重渲染，**绝不丢内容**。
   * @param {{ text: string }} message 正在流式写入的那条 assistant 消息
   */
  function paintStreamingBubble(message) {
    const bubble = streamingBubble();
    if (bubble === null) {
      renderTranscript();
      return;
    }
    bubble.textContent = message.text;
    transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * [XG-CUSTOM] 流式收尾：把 `streaming` 标记摘掉、内容定格、标注中断/停止原因。
   * 规则（对应 xiangwo-chat.ts 的 XiangwoStreamResult）：
   * - 正常结束 → 原样（文本已经在气泡里了）
   * - 中途断流 → **保留已收内容** + 下方标注「（连接中断，已显示部分内容）」
   * - 用户点停止 → 保留已收内容 + 「（已停止）」
   * - 一个字都没有 → 给一句人话（不留空气泡）
   * @param {{ text: string, streaming?: boolean }} message 流式消息
   * @param {object} result streamXiangwoChat 的返回值
   */
  function settleStreamingMessage(message, result) {
    delete message.streaming;
    const text = typeof result.text === 'string' ? result.text : message.text;
    const note =
      result.aborted === true
        ? '（已停止）'
        : result.interrupted === true
          ? interruptedNoteText(result.idleMs ?? 0, result.interruptedReason ?? 'network')
          : '';
    if (text === '') {
      // 一个字都没渲染出来（还没收到正文就断了/停了）→ 至少留一句人话
      message.text = note === '' ? '（无回答）' : note;
      return;
    }
    message.text = note === '' ? text : `${text}\n${note}`;
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
    // [XG-CUSTOM] 流式：先把**空** assistant 气泡挂出来（message.streaming → renderTranscript 不跳过空文本），
    // 之后每个 delta 只改这个气泡（见 paintStreamingBubble）；结束/中断再定格标注。
    const assistant = { role: 'assistant', text: '', streaming: true };
    current.messages.push(assistant);
    renderTranscript();
    try {
      const target = await chatEndpoint();
      // [XG-CUSTOM] 主进程判定地址不可达（远程主机 + 没法转发）→ 先把人话提示摆出来，
      // 请求照发（万一网络其实通），失败文案仍然照旧。
      if (!target.reachable && target.hint !== '') status.textContent = target.hint;
      const result = await streamXiangwoChat({
        url: target.url,
        signal: controller.signal,
        body: {
          // [XG-CUSTOM] 要 SSE（协议见文件头 9)；服务端不支持就退化成整段 JSON）
          stream: true,
          // [XG-CUSTOM] 带上真实路由标识（XIANGWO_MODEL ?? 'xiangwo-8900'）。
          // **实测 8900 不支持用 model 选模型**（见主进程 xiangwo-orb-api.ts 的 orbModelCatalog：
          // 服务端只把这字段回显到响应体，未知名字也不报错），所以这里纯粹是"请求自述"，
          // 不产生任何"能切换"的 UI 承诺。没有 reasoningEffort：8900 不支持该入参。
          ...(overlayModelLabel === '' ? {} : { model: overlayModelLabel }),
          messages: [
            { role: 'system', content: systemPrefixFor(permission) },
            ...prior,
            { role: 'user', content: userContent },
          ],
        },
        // [XG-CUSTOM] 重试只发生在**连接建立阶段**（首字节之前），文案沿用「后端启动中…」
        onRetry: (attempt) => {
          status.textContent = retryStatusText(attempt);
        },
        // [XG-CUSTOM] 服务端状态/心跳 → 状态区（长工具循环里告诉用户"agent 还在干活"）
        onStatus: (line) => {
          status.textContent = line;
        },
        onHeartbeat: () => {
          status.textContent = XIANGWO_HEARTBEAT_STATUS;
        },
        onIdle: (idleMs) => {
          status.textContent = waitingStatusText(idleMs);
        },
        // [XG-CUSTOM] 边收边渲染：追加到当前气泡（不等整段）
        onDelta: (delta) => {
          assistant.text += delta;
          status.textContent = '';
          paintStreamingBubble(assistant);
        },
      });
      settleStreamingMessage(assistant, result);
      status.textContent = result.aborted === true ? '已停止' : '';
    } catch (cause) {
      // [XG-CUSTOM] 地址可能过期（主机/隧道变了）→ 作废缓存，下一条重新解析
      chatTarget = undefined;
      if (controller.signal.aborted) {
        settleStreamingMessage(assistant, { text: assistant.text, aborted: true });
      } else {
        // 只有「一个字节都没收到」才走到这里（见 streamXiangwoChat）→ 人话文案，不再徒留 Failed to fetch
        delete assistant.streaming;
        assistant.text = streamFailureText(cause);
      }
    } finally {
      delete assistant.streaming;
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
    // [XG-CUSTOM] 流式下「停止」= abort 这次 fetch（见 streamXiangwoChat）；已经收到的内容保留在气泡里
    if (sendAbort === undefined) return;
    status.textContent = '正在停止…';
    sendAbort.abort();
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
      empty.textContent =
        pagesMenuHint.textContent === '' ? '当前没有 agent 打开的网页' : pagesMenuHint.textContent;
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
        (transcript.contains(anchor) ||
          transcript === anchor ||
          transcript.contains(anchor.parentNode));
      if (!inTranscript) return undefined;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      return { text, rect };
    };

    const hideBar = () => {
      selectionBar.hidden = true;
    };

    /**
     * [XG-CUSTOM] 跑一个划词动作。**翻译 = 立刻把提示词发出去**（用户实测"点了没反应"：
     * 旧实现只把提示词塞进输入框、不发送、也没有任何反馈，用户看不出发生了什么）。
     * @param {string} action `search` / `translate` / `send`
     */
    const runAction = (action) => {
      const text = selectionBar.dataset.selection ?? '';
      if (text === '') return;
      if (action === 'search') {
        void orbApi('host.openExternal', {
          url: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
        });
        return;
      }
      // 翻译 / 发给项我 都要**真的发一条消息**。正在流式回答时 send() 会静默早退（见 send 的
      // `if (sending) return`）→ 这里必须给人话反馈，否则又变成"点了没反应"。
      if (sending) {
        status.textContent = '（项我正在回答，等它说完再发）';
        return;
      }
      void send(action === 'translate' ? `把下面这段翻译成中文：\n${text}` : text);
    };

    // [XG-CUSTOM] 点工具条自己那一下的三件事（治"点了没反应"）：
    // ① `preventDefault()` 保住选区与焦点（默认行为会折叠选区 → selectionchange 把条收掉 → click 落空）；
    // ② 动作**绑在 mousedown** 上执行，不等 click —— 天然免疫"条在 mouseup 前被隐藏"这一类落空；
    // ③ `suppressHide`：这一轮按下-抬起里不许 selectionchange/mouseup 收条或重弹（mouseup 后清）。
    let suppressHide = false;
    /** [XG-CUSTOM] 这一轮按下是不是"在转录区里开始划选"——只有这种手势才允许 mouseup 弹条 */
    let selectionGesture = false;
    selectionBar.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button === null) return;
      runAction(button.dataset.action);
    });
    document.addEventListener('mousedown', (event) => {
      if (selectionBar.contains(event.target)) {
        suppressHide = true;
        return;
      }
      // 新手势（点别处）：清掉上一次可能残留的标志（比如上一次抬起丢在窗口外、没等到 mouseup）
      suppressHide = false;
      selectionGesture = transcript.contains(event.target) || transcript === event.target;
      // 点在转录区之外（输入框 / 工具条行 / 窗口空白）= 明确的"收掉划词条"手势。
      // 光靠 mouseup 的选区判断不够：Chrome 在非可选区域按下不一定会折叠已有选区，
      // 于是点空白后条又被弹回来（用户看到的"关不掉"）。
      if (!selectionGesture) hideBar();
    });

    document.addEventListener('mouseup', (event) => {
      if (suppressHide) {
        // 这一轮是"点工具条"：动作已在 mousedown 跑过，别再弹条（收条在 click 里做）
        suppressHide = false;
        return;
      }
      // 点在工具条自己身上就别动（否则按钮点不到）
      if (selectionBar.contains(event.target)) return;
      // 这一轮不是在转录区里起手的（点空白/输入框等）→ 不弹条
      if (!selectionGesture) return;
      const found = readSelection();
      if (found === undefined) {
        hideBar();
        return;
      }
      // [XG-CUSTOM] 工具条是 `<body>` 的绝对定位子元素（最近定位祖先 = 初始包含块），
      // 而这里原来按**面板** rect 算坐标 → 每次都偏移一个 --chrome（12px），真机上条会被画到
      // 面板外的透明边距里（被裁 + 落在 X11 SHAPE 之外点不到）。现在统一用视口坐标，
      // 并把整条**夹进面板矩形**（面板 = 窗口可见/可点的形状），保证三个按钮都点得到。
      // 尺寸也不能写死估计值（原来假设 190 宽 → 实际 162，条整体偏离选区中心 ~14px）：
      // 先隐藏着亮出来量真实尺寸，再定位（量完才解除 visibility，不会闪）。
      selectionBar.dataset.selection = found.text;
      selectionBar.style.visibility = 'hidden';
      selectionBar.hidden = false;
      const barBox = selectionBar.getBoundingClientRect();
      const barWidth = barBox.width;
      const barHeight = barBox.height;
      const panelRect = panel.getBoundingClientRect();
      const minLeft = panelRect.left + 8;
      const maxLeft = Math.max(minLeft, panelRect.right - barWidth - 8);
      const left = Math.min(
        Math.max(minLeft, found.rect.left + found.rect.width / 2 - barWidth / 2),
        maxLeft
      );
      const minTop = panelRect.top + 8;
      const maxTop = Math.max(minTop, panelRect.bottom - barHeight - 8);
      const above = found.rect.top - barHeight - 6;
      // 选区上方放不下就翻到下方（仍夹在面板内），永远不越出面板
      const top = Math.max(
        minTop,
        Math.min(above >= minTop ? above : found.rect.bottom + 6, maxTop)
      );
      selectionBar.style.left = `${Math.round(left)}px`;
      selectionBar.style.top = `${Math.round(top)}px`;
      selectionBar.style.visibility = '';
    });
    document.addEventListener('selectionchange', () => {
      if (suppressHide) return; // 工具条按下期间的选区变化不是"用户在改选区"
      const selection = window.getSelection();
      if (selection === null || selection.isCollapsed) hideBar();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hideBar();
    });
    // 鼠标路径的动作已经在 mousedown 跑过，click 只负责收条；键盘激活（Enter/Space 的 click
    // detail === 0，没有 mousedown）才在这里补跑一次，别把无障碍路径弄丢。
    selectionBar.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button === null) return;
      if (event.detail === 0) runAction(button.dataset.action);
      hideBar();
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
   * 收尾一次按下：清状态、必要时落盘位置 + **提交边缘停靠**。
   * 松手时主进程按球压住屏幕边缘的程度决定"吸边成 6px 细条"还是"夹回工作区"，
   * 返回值里的 `docked` 就是这一下的结论（见 applyDockedFrom）。
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
    // [XG-CUSTOM] canDock = !(running || 提问卡待答)；主进程还会用 running 护栏兜一层。
    // 返回值里 `docked` 决定吸不吸边，`dockRefused` 决定要不要给"为什么没吸"的可见反馈。
    applyDockOutcome(await bridge.orbDragEnd?.(canDockNow()));
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
        // [XG-CUSTOM] 归位也是一次"松手"：同样要提交停靠结论（否则归位后细条状态会对不上）
        applyDockOutcome(await bridge.orbDragEnd?.(canDockNow()));
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

  // [XG-CUSTOM] 停靠细条（6px）：悬停 800ms → 滑回（applyDocked 里的计时器），
  // 拖它朝屏幕内侧移 > DOCK_DRAG_OFF_PX → 立刻解锁（拖到哪算哪，不跟手移动 —— 主进程会做滑回动画）。
  if (dockTab !== null) {
    dockTab.addEventListener('pointerenter', () => {
      dockPointerInside = true;
      if (docked !== undefined && dockHoverArmed) void unsnapDocked();
    });
    dockTab.addEventListener('pointerleave', () => {
      dockPointerInside = false;
    });
    dockTab.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dockDrag = { startX: event.screenX, startY: event.screenY, moved: false };
      try {
        dockTab.setPointerCapture(event.pointerId);
      } catch {
        /* 捕获失败也能靠 pointerup/leave 收尾 */
      }
    });
    dockTab.addEventListener('pointermove', (event) => {
      if (dockDrag === undefined || docked === undefined) return;
      if ((event.buttons & 1) !== 1) {
        dockDrag = undefined;
        return;
      }
      // [XG-CUSTOM] screen 坐标在真机上是物理像素（见 detectScreenUnit），这里沿用最近标定过的系数
      const unit = lastScreenUnit > 0 ? lastScreenUnit : 1;
      const inward =
        docked === 'right'
          ? (dockDrag.startX - event.screenX) / unit
          : (event.screenX - dockDrag.startX) / unit;
      trace('dock-tab-drag', { inward: Math.round(inward), side: docked, unit });
      if (inward <= DOCK_DRAG_OFF_PX) return;
      dockDrag.moved = true;
      void unsnapDocked();
    });
    const endDockDrag = (event) => {
      const drag = dockDrag;
      dockDrag = undefined;
      if (drag === undefined || drag.moved) return;
      // 单击细条 = 滑回（比等 800ms 更直接；上游只有 hover 一条路）
      if (
        Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) <= DOCK_DRAG_OFF_PX
      ) {
        void unsnapDocked();
      }
    };
    dockTab.addEventListener('pointerup', endDockDrag);
    dockTab.addEventListener('pointercancel', () => {
      dockDrag = undefined;
    });
    dockTab.addEventListener('lostpointercapture', () => {
      dockDrag = undefined;
    });
  }
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
    void runOrbContextMenu(event.target);
  });

  // [XG-CUSTOM] 面板里也要能右键：cut/copy/paste 只有在**可编辑的地方**才有意义，
  // 而球本身永远不可编辑 —— 只挂球的话这三项永远出不来（实测：右键球之后
  // document.activeElement 变成 #ball，按"焦点"判定必然是 false）。
  // 上游的 overlay 菜单覆盖整个浮窗，这里对齐：面板任意位置右键都弹同一个原生菜单。
  // 编辑态按**右键命中的元素**算（Electron 的 isEditable 也是这个语义，不是 activeElement）。
  panel.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    trace('panel-contextmenu', { target: event.target?.id ?? event.target?.tagName ?? null });
    void runOrbContextMenu(event.target);
  });

  /**
   * [XG-CUSTOM] 报给主进程的「右键命中的地方可编辑吗」+ 剪贴板动作可用性
   * （照上游 FloatingContextEditState）。
   *
   * 关键：用**右键命中的元素**（`target`），不是 `document.activeElement` ——
   * Chrome 在非编辑区右键 mousedown 时会把焦点挪过去（球是 `<button>`，右键后
   * activeElement 就变成球了），按焦点判定的话这三项永远出不来。
   * 语义照 Electron：`canCopy` 只要有选区就行（转录区选中文字也该能复制）；
   * `canCut`/`canPaste` 要求命中的地方真的可编辑。剪贴板内容读不到（没有同步 API），
   * 所以 paste 只看"可编辑"。
   * @param {EventTarget|null} target 右键命中的元素
   * @returns {{ editable: boolean, editFlags: { canCut: boolean, canCopy: boolean, canPaste: boolean } }}
   */
  function editState(target) {
    const element = target instanceof Element ? target : null;
    const field =
      element === null ? null : element.closest('input, textarea, [contenteditable="true"]');
    const editable =
      field !== null &&
      (field.isContentEditable === true ||
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement);
    let hasSelection = false;
    if (field !== null && typeof field.selectionStart === 'number') {
      // <input>/<textarea>：选区在控件自己的 selectionStart/End 上
      hasSelection = field.selectionStart !== field.selectionEnd;
    }
    if (!hasSelection) {
      // contenteditable / 转录区：选区在 window.getSelection() 上（右键不会折叠它）
      const selection = window.getSelection();
      hasSelection = selection !== null && selection.toString().trim() !== '';
    }
    return {
      editable,
      editFlags: { canCut: editable && hasSelection, canCopy: hasSelection, canPaste: editable },
    };
  }

  async function runOrbContextMenu(target = null) {
    let result = null;
    try {
      result = await api.floating.contextMenu(editState(target));
    } catch (cause) {
      trace('contextmenu-error', { error: describeError(cause) });
      return;
    }
    // [XG-CUSTOM] 主进程现在回的是 `{action, avatarChanged?, message?, selectionEnabled?}`；
    // 兼容老形状（纯字符串 action），避免主/渲染两侧版本错位时彻底没反应。
    const action = typeof result === 'string' ? result : (result?.action ?? null);
    trace('contextmenu-action', { action });
    if (result !== null && typeof result === 'object') {
      if (result.avatarChanged === true) await refreshAvatar();
      if (typeof result.message === 'string' && result.message !== '')
        status.textContent = result.message;
      if (typeof result.selectionEnabled === 'boolean') {
        selectionToolbarEnabled = result.selectionEnabled;
        status.textContent = result.selectionEnabled ? '划词工具条：已启用' : '划词工具条：已停用';
      }
    }
    if (action === 'open-main') void bridge.orbOpenMain?.();
    else if (action === 'toggle-panel') {
      const { open } = await panelOpenState();
      await (open ? closePanel() : openPanel());
    } else if (action === 'mcp-market') {
      // [XG-CUSTOM 2026-10-05] 工具市场：展开面板 + 发一条**能稳定触发 mcp_market** 的消息
      // （卡片的解析/渲染/过滤见 ./xiangwo-mcp.ts；数据由 agent 侧 xg_mcp_market.py 生成）
      if (!expanded) await openPanel();
      void send('打开 MCP 工具市场（调用 mcp_market，把块原样贴出来）');
    } else if (action === 'quit') void bridge.orbQuit?.();
  }

  bridge.onOrbMode?.((mode, isPinned, direction, dockedSide) => {
    applyPinned(isPinned);
    // [XG-CUSTOM] 主进程带了方向就跟着换角的类（移动导致方向变化时，这里是唯一的同步点）
    if (direction !== undefined && direction !== null) applyDirection(direction);
    // [XG-CUSTOM] 停靠侧：主进程在吸边/滑回完成的瞬间推过来（也带 null = 已解锁）。
    // 这是"重启后恢复停靠态"以及"拖细条解锁"的同步点（另一个是 move/clamp/unsnap 的返回值）。
    if (dockedSide !== undefined) applyDocked(dockedSide);
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
    // [XG-CUSTOM] state[3] = 停靠侧（重启后主进程直接以停靠态建窗，这里补上 body.docked-*）
    if (state.length > 3) applyDocked(state[3]);
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
  /**
   * [XG-CUSTOM] 刷新球的头像（上游 orb-avatar.ts 的等价物）。
   *
   * 主进程从 `userData/xiangwo-orb-avatar.{png,gif,webp}` 或 `xiangwo-orb-avatar.json` 读
   * （字节文件已过 magic bytes 校验）；没有就返回空串 → 摘掉 `has-avatar`、藏起 `<img>`，
   * 球回退到内置的「项」字（不是空白）。换头像/恢复默认之后都要再调一次。
   * @returns {Promise<void>}
   */
  async function refreshAvatar() {
    try {
      const avatarUrl = await api.floating.avatarUrl();
      const has = typeof avatarUrl === 'string' && avatarUrl !== '';
      if (has) ballAvatar.src = avatarUrl;
      else ballAvatar.removeAttribute('src');
      ballAvatar.hidden = !has;
      document.body.classList.toggle('has-avatar', has);
    } catch {
      /* 读不到头像就保持内置「项」 */
    }
  }

  /**
   * [XG-CUSTOM] 面板选项行的「工作区只读芯片」：显示 `floating.orbWorkspacePath()` 的 basename，
   * `title` 给全路径（点不开、只读，纯粹让用户知道当前活落在哪个目录）。
   * 这是 `orbWorkspacePath` 这个 API 的第一个真实调用点（此前只有实现没有调用方）。
   */
  async function renderWorkspaceChip() {
    if (workspaceChip === null) return;
    let full = '';
    try {
      const value = await api.floating.orbWorkspacePath();
      if (typeof value === 'string') full = value.trim();
    } catch {
      /* 拿不到就整颗芯片不显示 */
    }
    if (full === '') {
      workspaceChip.hidden = true;
      return;
    }
    // 主进程给的是本机路径，用 node:path 的语义拆（两种分隔符都认，兼容 Windows 工作区）
    const parts = full.split(/[\\/]/).filter((part) => part !== '');
    workspaceChip.textContent = parts.length === 0 ? full : parts[parts.length - 1];
    workspaceChip.title = `工作区：${full}`;
    workspaceChip.hidden = false;
  }

  // [XG-CUSTOM] 启动即保证收起态：面板不挂载 = display:none，窗口里只有球（其余 100% 透明）。
  unmountPanel();
  renderTranscript();
  renderHistory();
  renderPermission();
  applyPinned(false);
  // [XG-CUSTOM 2026-10-03] 启动即解析 agent 基址：图片网格里的相对地址（/xg/img?u=…）靠它拼绝对
  // （见 xiangwo-images.ts）。**不 await**：解析（远程主机时可能等 SSH 转发几秒）绝不拖住球上屏；
  // 还没解析出来时历史网格先画「图片不可用」，基址到了再重画（见 applyAgentBaseUrl）。
  void chatEndpoint().catch(() => {
    /* 解析失败就保持空基址（相对地址的卡画「图片不可用」），发消息时还会再解析一次 */
  });
  await refreshAvatar();
  // [XG-CUSTOM] 当前真实路由标识（send() 带进请求体）+ 工作区芯片。
  // 取的是**模型目录的 current**（而不是那个硬编码的 overlayModel）：目录里带着
  // `supported:false` 这个实测结论，渲染侧拿到的就是主进程认证过的真实值。
  try {
    const catalog = await api.floating.modelCatalog();
    const model = catalog?.current?.model;
    if (typeof model === 'string') overlayModelLabel = model.trim();
  } catch {
    /* 读不到就不带 model 字段 */
  }
  await renderWorkspaceChip();
  // [XG-CUSTOM] 划词工具条开关（主进程落盘布尔，默认开）。**关掉时连 wireSelectionBar 都不调**，
  // 从源头上不监听 selectionchange / 不弹条（而不是弹出来再隐藏）。
  try {
    const enabled = await api.floating.selectionToolbar();
    if (typeof enabled === 'boolean') selectionToolbarEnabled = enabled;
  } catch {
    /* 读不到开关就保持默认「启用」 */
  }
  if (selectionToolbarEnabled) wireSelectionBar();
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
