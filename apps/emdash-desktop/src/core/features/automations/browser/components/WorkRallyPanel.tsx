// [XG-CUSTOM 2026-10-10] 「自动化 → WorkRally 出图」Tab —— 用户要求把 WorkRally **并入「自动化」界面**，
// 照 Kaneo 的先例（Kaneo 有两处入口：自动化里的双 Tab + 设置→集成里的卡片；WorkRally 原来**只有**后者）。
//
// 用户原话：「**要结合集成与自动化，有些地方要到集成里调的话，就搞个按钮一点就进入集成里改**」。
// ⇒ 定位原则（写死在这里，别再各自发挥）：
//    · **自动化 = 日常操作**（看流水线 + 出图）
//    · **集成 = 配置与连接**（端点 / 模式 / 服务状态 / 图片线开关）
//    · 跨界的操作一律**按钮跳转**，**不复制第二份 UI**。
//
// ## 为什么用 <iframe> 指到 `:8189/panel`
// · 仓里**已有先例**：同目录 `KaneoBoardPanel.tsx` 用 `<iframe src>` 看 Archify 图；
//   `host-contract.ts` 的注释也把「面板用 `<iframe src>` 指到 8900 的 /xg/diagram/」写成既定做法
//   ⇒ **不需要新造 webview 体系**（Electron 的 `webviewTag: true` 也开着，但这里用不上）。
// · 面板是**自包含页面**（零外部依赖），直接内嵌比在 React 里重写一遍调参 UI 省得多。
//
// ## ⚠️ sandbox 为什么必须带 allow-same-origin（这条是**实测约束**，不是随手加的）
// · 面板要 `fetch('/v1/*')` + `localStorage`。若只给 `allow-scripts`（= 不透明源）：
//   ① fetch 变成**跨域**请求，而本地 Server 的 `_send()` **不发任何 CORS 头**
//      ⇒ 所有 `/v1/*` 调用被浏览器拦掉（面板会显示"读不到 /v1/models"）；
//   ② `localStorage` 在**不透明源**下**直接抛异常**，而面板里 `localStorage.setItem/getItem`
//      **没包 try/catch**（`workrally_panel.html:167/173`）⇒ 脚本会中断 ⇒ 白屏。
// · ⇒ 必须同源。`allow-scripts + allow-same-origin` 会让 frame **能自行解除 sandbox** ——
//   之所以可接受：被嵌的是**我们自己的本地可信页**（127.0.0.1:8189，本机 Server 提供）。
//   若将来要收紧：给 Server 加 CORS 头 + 给面板的 localStorage 包 try/catch，就能退回 `allow-scripts`。
import { Button } from '@emdash/ui/react/primitives';
import { ExternalLink, Settings } from 'lucide-react';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';

/** 面板地址（本地 Server 提供；服务常驻：系统级 `workrally-local.service`）。 */
const PANEL_URL = 'http://127.0.0.1:8189/panel';

/**
 * 「去集成里调」时留下的**锚点提示**：`IntegrationsCard` 挂载时读它 → 滚到那张卡并高亮。
 *
 * ⚠️ 为什么用 sessionStorage 而不是路由参数：设置页的 params（`tab`/`detail`）语义是
 * 「哪一页 / 哪条 detail 路径」，**没有"高亮哪张卡"这一维**；为它改设置页的 params 语义
 * 会牵扯别的页面。这里只需要一个**一次性的 UI 提示**，用完即删 ⇒ 用 sessionStorage 最省。
 * 键名与 `IntegrationsCard.tsx` 里的**同一个字面量**（两处各一份，注释互指；不新增共享模块以免
 * 让 settings → automations 产生跨 feature 依赖）。
 */
const HIGHLIGHT_KEY = 'xg.goto.workrally';

export function WorkRallyPanel() {
  const { navigate } = useNavigate();
  return (
    <div className="flex w-full flex-col gap-4">
      {/* 顶部说明条 + 跳转按钮 */}
      <div className="border-border bg-background-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-foreground text-sm font-medium">WorkRally 出图（本地）</span>
          <span className="text-foreground-muted text-xs">
            调参 → 生成。当前模式（只建卡 / 直接出图）由本地 Server 决定，面板顶部会显示。
            <b> 配置与连接</b>（端点 · 模式 · 服务状态 · 图片线开关）在 设置 → 集成 里调。
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              try {
                sessionStorage.setItem(HIGHLIGHT_KEY, '1');
              } catch {
                /* 隐私模式等场景：跳过去就行，不高亮 */
              }
              navigate(settingsViewDef({ tab: 'integrations' }));
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            去集成里调
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => window.open(PANEL_URL, '_blank')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            在独立窗打开
          </Button>
        </div>
      </div>

      {/* 面板本体 */}
      <div className="border-border bg-background h-[72vh] min-h-[460px] w-full overflow-hidden rounded-md border">
        <iframe
          title="WorkRally 出图参数面板"
          src={PANEL_URL}
          // 见文件头「sandbox 为什么必须带 allow-same-origin」—— panel 要 fetch + localStorage
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
