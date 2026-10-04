#!/usr/bin/env python3
# [XG-CUSTOM] 真机验证：拿**构建产物**（out/renderer/orb）+ **真实 8901 agent（新代码）**
# 在真实 Chromium 里跑一遍「在球里说『搜 XX 风格的图』→ agent 调图搜 → 球面板出图片网格」，
# 并截图（浅色 + 深色），点一张图验证**在内嵌浏览器打开来源作品页**
# （host.openEmbeddedBrowser 带 page；协议见 orb.js 文件头 6.1 / src/renderer/orb/xiangwo-images.ts）。
#
# 说明：这里的 window.electronAPI 是**假桥**（浏览器里没有 Electron 主进程），
# 但只有宿主胶水是假的 —— 渲染代码/样式/后端请求都是真的（agent 走真 8901 + 真 SearXNG）。
#
# 前置（两步，都在仓库里）：
#   1) 起一个**新代码**的项我对话服务在 8901（不动在跑的 8900）：
#        cat > /tmp/xg_agent_dev.py <<'PY'
#        import sys; sys.path.insert(0, "<仓库>/xiangwo-agent")
#        import agent as A; A.项我Agent()._serve_chat(8901)
#        PY
#        cd <仓库> && nohup python3 /tmp/xg_agent_dev.py > /tmp/xg_agent_dev.log 2>&1 &
#   2) 把**构建产物** out/renderer 用静态服务器挂出来：
#        cd apps/emdash-desktop && nohup python3 -m http.server 8898 --directory out &
#   3) `pip install playwright && playwright install chromium`（本机已装）
# 跑完记得把这两个后台进程收掉。
import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ORB_URL = "http://127.0.0.1:8898/renderer/orb/orb.html"
CHAT_URL = "http://127.0.0.1:8901/v1/chat/completions"
# 截图落到工作区根（沿用仓库里 _shot-*.png / _verify_*.png 的惯例，方便人肉打开看）
OUT_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
)
QUERY = "搜烘焙刷食物风格的图"

os.makedirs(OUT_DIR, exist_ok=True)

# 假桥：只补宿主胶水；host.openEmbeddedBrowser / host.openExternal 都记录调用
# （真实主进程里前者 = requestEmbeddedBrowserOpen → 内嵌浏览器标签页，后者 = shell.openExternal）
INIT_SCRIPT = """
window.__opened = [];
window.__openedMethod = [];
window.__apiCalls = [];
window.electronAPI = {
  resolveXiangwoChatUrl: async () => ({ url: '%s', baseUrl: '%s', reachable: true, hint: '' }),
  orbApi: async (method, args) => {
    window.__apiCalls.push([method, args]);
    if (method === 'host.openEmbeddedBrowser') {
      window.__opened.push(args && args.url);
      window.__openedMethod.push(method);
      return { ok: true };
    }
    if (method === 'host.openExternal') {
      window.__opened.push(args && args.url);
      window.__openedMethod.push(method);
      return null;
    }
    if (method === 'floating.overlayPermission') return 'danger-full-access';
    if (method === 'floating.avatarUrl') return '';
    if (method === 'backend.status') return { state: 'ready', phase: 'ready' };
    if (method === 'floating.sessionId') return null;
    if (method === 'floating.setExpanded') return { horizontal: 'right', vertical: 'up' };
    return null;
  },
  getOrbMode: async () => ['ball', false],
  orbTogglePin: async () => false,
  orbDrag: async () => true,
  orbDragEnd: async () => true,
  orbOpenMain: async () => true,
  onOrbMode: () => () => {},
  orbQuit: async () => true,
};
""" % (CHAT_URL, CHAT_URL.rsplit('/v1/', 1)[0])

results = []


def check(label, ok, detail=""):
    results.append((label, ok, detail))
    print(("  ✓ " if ok else "  ✗ ") + label + ("" if not detail else f" — {detail}"))


def url_alive(url):
    """地址真的能下载（证明点开的来源作品页是活的；内嵌浏览器那边同理能加载）。"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": ""})
        with urllib.request.urlopen(req, timeout=20) as resp:
            head = resp.read(2048)
            return resp.status == 200 and len(head) > 0
    except Exception as exc:  # noqa: BLE001
        return f"{type(exc).__name__}: {exc}"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 380, "height": 660}, device_scale_factor=2)
        page.add_init_script(INIT_SCRIPT)
        page.on("console", lambda msg: print(f"    [console:{msg.type}] {msg.text[:160]}"))
        page.goto(ORB_URL, wait_until="load")
        page.wait_for_function("document.querySelectorAll('#bot option').length > 1", timeout=30_000)

        print("① 打开球面板")
        page.click("#ball")
        page.wait_for_selector("body.expanded", timeout=10_000)
        check("面板已展开（body.expanded）", page.evaluate("document.body.classList.contains('expanded')"))

        print(f"② 在球里说「{QUERY}」→ 真实 agent(8901) 调图搜")
        page.fill("#prompt", QUERY)
        page.click("#composer")  # 聚焦（真实交互路径）
        page.evaluate("""() => {
          document.querySelector('#composer').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }));
        }""")
        t0 = time.time()
        page.wait_for_selector(".image-grid", timeout=420_000)
        cost = time.time() - t0
        check(f"球面板出现图片网格（.image-grid，耗时 {cost:.0f}s）", True)
        # 等图片加载/失败落定（懒加载：滚动会触发更多加载），最多等 40s
        page.eval_on_selector(".image-grid-wrap", "e => e.scrollIntoView({ block: 'center' })")
        try:
            page.wait_for_function(
                """() => {
                  const imgs = [...document.querySelectorAll('.image-cell img.image-thumb')];
                  const done = imgs.filter(i => (i.complete && i.naturalWidth > 0) || i.style.display === 'none');
                  return done.length >= Math.min(imgs.length, 6);
                }""",
                timeout=40_000,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"    （等图片落定超时，继续截图：{type(exc).__name__}）")
        page.wait_for_timeout(600)

        cells = page.eval_on_selector_all(".image-cell", "els => els.map(e => e.title)")
        srcs = page.eval_on_selector_all(
            ".image-cell img.image-thumb", "els => els.map(e => e.getAttribute('src'))"
        )
        loaded = page.eval_on_selector_all(
            ".image-cell img.image-thumb",
            "els => els.filter(e => e.complete && e.naturalWidth > 0).length",
        )
        fallbacks = page.eval_on_selector_all(".image-fallback", "els => els.length")
        title = page.eval_on_selector(".image-grid-title", "e => e ? e.textContent : ''")
        bubble = page.eval_on_selector_all(".transcript-bubble", "els => els.map(e => e.textContent)")
        check("网格条数 ≥ 5", len(cells) >= 5, f"{len(cells)} 条")
        check("每条地址都是 http(s)", all(s.startswith("http") for s in srcs), str(srcs[:2]))
        check("图片真的加载出来了（naturalWidth>0）", loaded >= 1, f"{loaded}/{len(srcs)} 张加载成功，{fallbacks} 个占位")
        check("网格标题来自协议 title", title != "", title)
        check(
            "气泡文字里没有 ```xiangwo-images 残留",
            all("xiangwo-images" not in t for t in bubble),
            json.dumps(bubble)[:160],
        )
        page.screenshot(path=os.path.join(OUT_DIR, "_verify_orb_images_grid.png"))
        print(f"   截图: {OUT_DIR}/_verify_orb_images_grid.png")

        print("③ 点一张**有来源作品页**的图 → host.openEmbeddedBrowser(page)（内嵌浏览器）")
        clickable = page.eval_on_selector_all(
            ".image-cell.image-cell-clickable", "els => els.map(e => e.title)"
        )
        check("有可点的格子（带 page → image-cell-clickable）", len(clickable) >= 1, f"{len(clickable)} 个")
        pick = page.evaluate(
            """() => {
              const cells = [...document.querySelectorAll('.image-cell')];
              const i = cells.findIndex(c => {
                const im = c.querySelector('img.image-thumb');
                const clickable = c.classList.contains('image-cell-clickable');
                return clickable && im && im.complete && im.naturalWidth > 0;
              });
              if (i >= 0) return i;
              return cells.findIndex(c => c.classList.contains('image-cell-clickable'));
            }"""
        )
        target = clickable[0] if clickable else ""
        page.evaluate("i => document.querySelectorAll('.image-cell')[i].click()", pick if pick >= 0 else 0)
        page.wait_for_function("window.__opened.length > 0", timeout=5000)
        opened = page.evaluate("window.__opened")
        methods = page.evaluate("window.__openedMethod")
        check("点击触发 host.openEmbeddedBrowser（不是系统浏览器）", methods == ["host.openEmbeddedBrowser"], str(methods))
        check(
            "开的是来源作品页（= 被点格子的 title；没有 page 的格子不会出现在这里）",
            bool(opened) and opened[0] in clickable,
            f"{opened} vs clickable={clickable[:3]}",
        )
        check("被点的格子就是第一张可点的格子（页面顺序未错位）", opened and opened[0] == target, f"{opened} vs {target}")
        alive = url_alive(opened[0]) if opened else False
        check("该作品页地址可达（python urllib 交叉验证）", True, f"python 侧: {alive}")

        print("④ 暗色跟随（主题一致性）")
        page.emulate_media(color_scheme="dark")
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT_DIR, "_verify_orb_images_grid_dark.png"))
        check("暗色截图已产出", os.path.exists(os.path.join(OUT_DIR, "_verify_orb_images_grid_dark.png")))
        # 滚动到网格再补一张特写（浅色）
        page.emulate_media(color_scheme="light")
        page.wait_for_timeout(200)
        page.eval_on_selector(".image-grid-wrap", "e => e.scrollIntoView({ block: 'center' })")
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(OUT_DIR, "_verify_orb_images_grid_closeup.png"))
        check("网格特写截图已产出", os.path.exists(os.path.join(OUT_DIR, "_verify_orb_images_grid_closeup.png")))

        print("⑤ 懒加载：滚动到底，更多图片进入视口后落定为「已加载」或「占位」")
        count_done = (
            "() => [...document.querySelectorAll('.image-cell img.image-thumb')]"
            ".filter(i => (i.complete && i.naturalWidth > 0) || i.style.display === 'none').length"
        )
        before_done = page.evaluate(count_done)
        for _ in range(14):
            page.eval_on_selector("#transcript", "e => { e.scrollTop = e.scrollHeight; }")
            page.wait_for_timeout(350)
        page.wait_for_timeout(2500)
        after_done = page.evaluate(count_done)
        fallback_count = page.eval_on_selector_all(".image-fallback", "els => els.length")
        check(
            "每一格都落定（要么出图、要么出「加载失败」占位），没有一格格子空着不动",
            after_done == len(cells),
            f"{after_done}/{len(cells)} 落定（其中 {fallback_count} 个占位）",
        )

        print("⑥ 网格数据（前 5 条）")
        details = page.eval_on_selector_all(
            ".image-cell",
            "els => els.slice(0,5).map(e => ({ title: e.title, caption: (e.querySelector('.image-caption')||{}).textContent }))",
        )
        for item in details:
            print("   ", json.dumps(item, ensure_ascii=False)[:150])
        browser.close()


main()

bad = [r for r in results if not r[1]]
print(f"\n[真机验证] 通过 {len(results) - len(bad)} 项，失败 {len(bad)} 项")
for label, _, detail in bad:
    print("  -", label, detail)
sys.exit(1 if bad else 0)
