// [XG-CUSTOM 2026-10-10] 项我球面板的 **Markdown 渲染** —— 治「球侧回的正文有点乱，聊窗却不错」。
//
// ## 为什么（实测，不是感觉）
//   球气泡原来是 `bubble.textContent = text`（`orb.js:950` 定格 / `:1896` 流式）⇒ **纯文本**；
//   `grep -rn markdown src/renderer/orb/` = **0 命中**。
//   而 emdash 聊天窗是 `packages/ui/src/react/components/markdown/markdown.tsx`
//   = `react-markdown` + `remark-gfm` + `remark-math`
//   ⇒ 同一个回答：聊窗渲染成标题/粗体/列表/表格；球侧把 `**粗**`、`- 列表`、`| 表 |` 原样显示
//   （表格落进 `max-width:92%` + `overflow-wrap:anywhere` 的气泡里必然乱）。
//
// ## 为什么**不加新依赖**（照 emdash/AGENTS.md 的「优先复用既有依赖」）
//   聊窗那套 `react-markdown` 是 **React 组件**，而球面板是 **vanilla 的独立 bundle**
//   ⇒ 直接复用要为此把 React 拉进球的页面（不划算）。但它底下那半条链**本来就是既有依赖**、
//   且已在同一个 node_modules 里（同一份实例、同一批版本）：
//   `unified` + `remark-parse` + `remark-gfm` + `remark-rehype` + `hast-util-to-html`。
//   于是**零新增第三方包**，还拿到与聊窗**同一套 GFM 语义**（表格 / 任务列表 / 删除线）。
//
// ## 安全模型（与聊窗同源，都在这里钉住）
//   * `remark-rehype` **默认丢弃原始 HTML**（无 `allowDangerousHtml`）⇒ 实测
//     `<script>alert(1)</script>` / `<iframe>` / `<img onerror=…>` **一个都不进输出**；
//   * 但 **`javascript:` 链接会原样透出**（实测 `[x](javascript:alert(2))` → `href="javascript:…"`）
//     ⇒ 本模块自己走一遍 hast 树：**非 http(s)/mailto/# 的 `href` 一律删掉**；
//   * **`img` 一律降级成文字**：球里的图走 `xiangwo-images` 块（服务端 `/xg/img` 代理：防盗链 +
//     不暴露本机路径）；放开 `<img>` = 让模型绕开那条代理、让渲染器直接去拉任意外链。
//   * 任务列表的 `<input type=checkbox disabled>` **保留** —— 原始 HTML 已被丢弃，
//     唯一的来源就是 remark-gfm 自己的生成器（构造上安全），保留才与聊窗观感一致。
//
// ## 与聊窗的**有意**差异（别当 bug）
//   * 公式（聊窗的 `remark-math`）不渲染；
//   * Markdown 图片（`![alt](url)`）显示成文字 —— 理由见上面那条（代理/隐私）。
import { toHtml } from 'hast-util-to-html';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/** 只允许这几种 URI 方案（`javascript:` / `data:` / `file:` 一律干掉）。 */
export const XIANGWO_MD_URI_RE = /^(?:https?:|mailto:|#)/i;

/** hast 节点的最小形状（只声明我们真正读的字段，避免 `any`）。 */
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * 机器标记清理：球面板**不该显示**的内部记号（它们各有各的通道，显示出来就是"乱"）。
 *
 * 实测来源：`agent.py::_sse_stream` 在代理开过网页后会把
 * `\n[XG-PREVIEW]{url}[/XG-PREVIEW]\n` 直接写进 SSE 正文；而球这边
 * `grep -rn XG-PREVIEW src/renderer/orb/` **只有一句注释**（没有解析）⇒ 原样露给用户。
 * （开页本身走 emdash 内嵌浏览器通道；这个标记是给**跨机反向通道**用的，不是给球渲染的。）
 */
export function stripXiangwoMachineMarkers(text: string): string {
  let out = String(text ?? '');
  if (out === '') return out;
  // 成对的先删；再删**没闭合**的残形（截断/中断常见），绝不把半截记号留给用户
  out = out.replace(/\[XG-PREVIEW\][\s\S]*?\[\/XG-PREVIEW\]/g, '');
  out = out.replace(/\[XG-PREVIEW\][^\n]*/g, '');
  out = out.replace(/\[XG-IMG-META\][\s\S]*?\[\/XG-IMG-META\]/g, '');
  out = out.replace(/\[XG-IMG-META\][^\n]*/g, '');
  out = out.replace(/```?\[XG-IMAGES-REF:[^\]]*\]```?/g, '');
  out = out.replace(/\[XG-IMAGES-REF:?[^\]]{0,80}/g, '');
  return out;
}

/** 走一遍 hast：删危险 href；`img` 降级成文字（理由见文件头）。 */
function hardenHast(node: HastNode): void {
  if (node.type === 'element') {
    const props = node.properties ?? (node.properties = {});
    const href = props.href;
    if (typeof href === 'string' && !XIANGWO_MD_URI_RE.test(href)) delete props.href;
    const src = props.src;
    if (typeof src === 'string' && !XIANGWO_MD_URI_RE.test(src)) delete props.src;
    if (node.tagName === 'img') {
      const alt = typeof props.alt === 'string' ? props.alt : '';
      node.tagName = 'span';
      node.properties = {};
      node.children = [{ type: 'text', value: alt === '' ? '（图片）' : `🖼 ${alt}` }];
    }
  }
  for (const child of node.children ?? []) hardenHast(child);
}

/** 复用同一个 processor（无状态；每轮只 parse/runSync，不起进程、不阻塞）。 */
const MD = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

/**
 * 把一段（模型输出的）Markdown 渲染成**可安全 innerHTML 的 HTML**。
 *
 * @returns 成功 = HTML 串（非空文本时保证非空）；**失败或空文本 = `''`**（调用方退回 `textContent`）
 */
export function renderXiangwoMarkdown(text: string): string {
  const src = stripXiangwoMachineMarkers(text ?? '');
  if (src.trim() === '') return '';
  try {
    const mdast = MD.parse(src);
    const hast = MD.runSync(mdast) as unknown as HastNode;
    hardenHast(hast);
    const html = toHtml(hast as never);
    return typeof html === 'string' ? html : '';
  } catch {
    // 解析/序列化任何一步出错 ⇒ 交回纯文本兜底（宁可不排版，也不能让气泡空掉）
    return '';
  }
}

/**
 * 把渲染结果写进气泡：**HTML 优先、纯文本兜底**。
 *
 * 球面板是用户天天看的东西，**渲染器坏掉不能让气泡变空**（「空 ≠ 失败」是本项目反复踩的坑）
 * ⇒ 拿不到 HTML 就原样 `textContent`。
 * @param bubble 目标气泡元素
 * @param text 原始文本（模型输出）
 */
export function paintXiangwoMarkdown(bubble: HTMLElement, text: string): void {
  const raw = String(text ?? '');
  const html = renderXiangwoMarkdown(raw);
  if (html !== '') {
    bubble.innerHTML = html;
    return;
  }
  bubble.textContent = raw;
}
