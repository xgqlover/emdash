// [XG-CUSTOM 2026-10-16] 球侧「**回到底部**」圆钮的**漂移守卫**。
//
// 为什么要有它：`orb.html` / `orb.css` / `orb.js` 是**打进客户端**的静态资源，
// 上游一合并就可能被覆盖掉（这个仓里已经发生过多起"改了但下次合并没了"）。
// 这个测试只读三份文件、断言**三处接线都在**，不看像素、不跑浏览器。
//
// 口径来源：**DSH 聊天窗那一个**（用户就是指着它问"球侧怎么没有"）——
// `@deepseek-ai/dsh-client-ui-chat/lib/client.js`：`chat.toBottom` = "回到底部"、
// 只在 `!atBottom` 时渲染、阈值 `scrollHeight - scrollTop - clientHeight <= 25`、
// 点击 `el.scrollTop = el.scrollHeight`（**瞬时**，不是 smooth）、34px 圆钮。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'orb.html'), 'utf8');
const css = readFileSync(join(HERE, 'orb.css'), 'utf8');
const js = readFileSync(join(HERE, 'orb.js'), 'utf8');

describe('[XG-CUSTOM] 球侧「回到底部」钮（照 DSH 的不变量）', () => {
  it('① orb.html 有 #to-bottom，且标题/无障碍名都是「回到底部」', () => {
    expect(html).toContain('id="to-bottom"');
    expect(html).toContain('aria-label="回到底部"');
    expect(html).toContain('title="回到底部"');
    expect(html).toMatch(/id="to-bottom"[^>]*hidden/); // 默认隐藏：只在离开底部时才出现
  });

  it('② orb.css：34px 圆钮、hover 态、[hidden] 不显示、且**避开输入框**', () => {
    expect(css).toContain('#to-bottom {');
    expect(css).toContain('width: 34px'); // 与 DSH 同尺寸
    expect(css).toContain('border-radius: 100px'); // 与 DSH 同形
    expect(css).toContain('#to-bottom[hidden]');
    expect(css).toContain('body.expand-up #to-bottom');
    expect(css).toContain('calc(var(--composer-height) + 16px)'); // DSH 也是 +16
  });

  it('③ orb.js：定义了 wireToBottom 并且在启动装配时调用', () => {
    expect(js).toContain('function wireToBottom()');
    expect(js).toMatch(/wireDropTarget\(\);\s*\n\s*wireToBottom\(\);/);
    expect(js).toContain("document.getElementById('to-bottom')");
    expect(js).toContain("document.getElementById('transcript')");
  });

  it('④ 阈值与 DSH 一致（25px），点击是**瞬时**回到底（不是 smooth）', () => {
    expect(js).toContain('const NEAR = 25;');
    expect(js).toMatch(/transcript\.scrollTop = transcript\.scrollHeight/);
    expect(js).not.toMatch(/to-bottom[\s\S]{0,400}behavior: 'smooth'/); // 别把瞬时改成平滑
  });

  it('⑤ 流式增长时也要重算（MutationObserver）—— 否则"正在流"时状态是旧的', () => {
    expect(js).toMatch(/new MutationObserver\(sync\)\.observe\(transcript/);
  });

  it('⑥ **不动既有自动贴底**：`transcript.scrollTop = transcript.scrollHeight` 那几处仍在', () => {
    const hits = js.match(/transcript\.scrollTop = transcript\.scrollHeight/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5); // 原来就是 5 处，只许加不许减
  });
});
