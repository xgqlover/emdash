// [XG-CUSTOM 2026-10-10] 球面板 Markdown 渲染的**可证伪**验收（见 ./markdown.ts 的文件头）。
//
// 四件事必须钉住（前三件是安全，第四件是"别把用户的东西弄丢"）：
//   ① GFM 真的渲染了（标题/粗体/列表/表格）—— 这是"球侧文字乱"的直接判据；
//   ② **原始 HTML 一个都不进输出**（`<script>` / `<iframe>` / `<img onerror>`）；
//   ③ **`javascript:` 链接被剥掉 href**（remark-rehype 自己会漏掉这一个，本模块补的）；
//   ④ 渲染不出来时**退回纯文本**（球气泡绝不能变空）。
import { describe, expect, it } from 'vitest';
import { paintXiangwoMarkdown, renderXiangwoMarkdown, stripXiangwoMachineMarkers } from './markdown';

describe('renderXiangwoMarkdown：GFM 真渲染', () => {
  it('标题 / 粗体 / 行内码 / 列表', () => {
    const html = renderXiangwoMarkdown('# 标题\n\n**粗** 与 `code`\n\n- a\n- b');
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<strong>粗</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>a</li>');
  });

  it('GFM 表格（球面板原先把 | 表 | 原样显示 = "乱"的主要来源之一）', () => {
    const html = renderXiangwoMarkdown('| h1 | h2 |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>h1</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('任务列表保留勾选框（与聊窗观感一致）', () => {
    const html = renderXiangwoMarkdown('- [x] 做完\n- [ ] 没做');
    expect(html).toContain('type="checkbox"');
  });
});

describe('renderXiangwoMarkdown：安全（模型输出不可信）', () => {
  it('原始 HTML 一律丢弃', () => {
    const html = renderXiangwoMarkdown('<script>alert(1)</script>\n\n<iframe src="https://e"></iframe>\n\n<img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(');
  });

  it('javascript: 链接的 href 被剥掉（正文保留，别把用户的话删了）', () => {
    const html = renderXiangwoMarkdown('[点我](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('点我');
  });

  it('正常 https 链接照常保留', () => {
    const html = renderXiangwoMarkdown('[官网](https://example.com/a?b=1)');
    expect(html).toContain('href="https://example.com/a?b=1"');
  });

  it('Markdown 图片降级成文字（不产生 <img>：球里的图只走 xiangwo-images 代理）', () => {
    const html = renderXiangwoMarkdown('![包装图](https://evil/x.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('包装图');
  });
});

describe('stripXiangwoMachineMarkers：机器标记不给用户看', () => {
  it('清掉 [XG-PREVIEW]…[/XG-PREVIEW]（agent 侧 _sse_stream 会写进正文）', () => {
    expect(stripXiangwoMachineMarkers('开好了。\n[XG-PREVIEW]http://x/y[/XG-PREVIEW]\n可以看了。'))
      .toBe('开好了。\n\n可以看了。');
  });

  it('没闭合的残形也清掉', () => {
    expect(stripXiangwoMachineMarkers('看这个 [XG-PREVIEW]http://x/y')).not.toContain('XG-PREVIEW');
  });

  it('普通方括号**不动**（别把正常文字吃掉）', () => {
    const s = '[参考文献] 见下，[1] 是出处。';
    expect(stripXiangwoMachineMarkers(s)).toBe(s);
  });
});

describe('renderXiangwoMarkdown：边界', () => {
  it('空 / 纯空白 ⇒ ""（调用方据此退回纯文本）', () => {
    expect(renderXiangwoMarkdown('')).toBe('');
    expect(renderXiangwoMarkdown('   \n  ')).toBe('');
  });

  it('未闭合的标记不抛，仍出 HTML（流式途中的常态）', () => {
    expect(renderXiangwoMarkdown('**还没闭合')).toContain('还没闭合');
  });
});

describe('paintXiangwoMarkdown：HTML 优先、纯文本兜底', () => {
  /** 只需要 innerHTML/textContent 两个字段 ⇒ 用替身，测试不必起 jsdom/浏览器 */
  const fakeBubble = (): { innerHTML: string; textContent: string } => ({ innerHTML: '', textContent: '' });

  it('能渲染 ⇒ 写 innerHTML', () => {
    const bubble = fakeBubble();
    paintXiangwoMarkdown(bubble as unknown as HTMLElement, '**粗**');
    expect(bubble.innerHTML).toContain('<strong>粗</strong>');
  });

  it('渲染不出来（空文本）⇒ 退回 textContent，**绝不留空**', () => {
    const bubble = fakeBubble();
    paintXiangwoMarkdown(bubble as unknown as HTMLElement, '   ');
    expect(bubble.innerHTML).toBe('');
    expect(bubble.textContent).toBe('   ');
  });
});
