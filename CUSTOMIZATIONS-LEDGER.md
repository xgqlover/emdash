# emdash 定制台账（由 `[XG` 标记自动生成，别手改）

> 生成：`python3 scripts/xg-fork-ledger.py --write`｜校验：`--check`
> 判据：**每个定制文件里必须有 `[XG` 标记**；上游覆盖 → `--check` 立即报红。

合计 **500** 个定制文件。

## chat-ui（9）

| 文件 | 行 | 标记 |
|---|---|---|
| `packages/chat-ui/src/components/rows/message/assistant-ask.tsx` | 1 | // [XG-CUSTOM 2026-11-19] `xiangwo-ask` 卡片（Solid JSX）：把协议块渲染成可点的问卷。 |
| `packages/chat-ui/src/components/rows/message/assistant-images.css.ts` | 1 | // [XG-CUSTOM 2026-10-09] Styles for agent-sent image cards (assistant messages). |
| `packages/chat-ui/src/components/rows/message/assistant-images.test.ts` | 2 | * [XG-CUSTOM 2026-10-09] Unit tests for the agent-image card helpers. |
| `packages/chat-ui/src/components/rows/message/assistant-images.ts` | 1 | // [XG-CUSTOM 2026-10-09] Agent-sent image cards for assistant messages. |
| `packages/chat-ui/src/components/rows/message/assistant-run.tsx` | 1 | // [XG-CUSTOM 2026-11-19] `xiangwo-run` 卡片（Solid JSX）：显示"哪个专家在运行/完成/失败"。 |
| `packages/chat-ui/src/components/rows/message/message.css.ts` | 47 | /** [XG-CUSTOM 2026-10-28] 消息时间（页脚弱化、等宽数字）。 */ |
| `packages/chat-ui/src/components/rows/message/message.def.tsx` | 1 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `packages/chat-ui/src/components/rows/resource-link/ResourceLink.tsx` | 67 | // [XG-CUSTOM 2026-10-10] `target` is resolved by the desktop enrichment transform and stays |
| `packages/chat-ui/src/model.ts` | 48 | * [XG-CUSTOM 2026-10-09] An image **sent by the agent** (项我/xiangwo bridge). |

## core（42）

| 文件 | 行 | 标记 |
|---|---|---|
| `packages/core/src/primitives/acp-transcript/api/normalized-event.ts` | 20 | * [XG-CUSTOM 2026-10-09] Inline image block sent **by an agent**. |
| `packages/core/src/primitives/skills/api/merge-installed.ts` | 40 | // [XG-CUSTOM 2026-10-09] 带上只读标记（外部来源不可卸载） |
| `packages/core/src/primitives/skills/api/schemas.ts` | 17 | // [XG-CUSTOM 2026-10-09] 加 'central'（中央技能库只读来源） |
| `packages/core/src/primitives/skills/api/types.ts` | 15 | // [XG-CUSTOM 2026-10-09] 'central' = 项上集团中央技能库（skills-central，外部只读来源） |
| `packages/core/src/runtimes/acp/api/models/turns/index.ts` | 2 | export * from './resource-links'; // [XG-CUSTOM 2026-10-10] |
| `packages/core/src/runtimes/acp/api/models/turns/messages.test.ts` | 2 | * [XG-CUSTOM 2026-10-10] Wire-boundary tests for agent image metadata. |
| `packages/core/src/runtimes/acp/api/models/turns/messages.ts` | 14 | * [XG-CUSTOM 2026-10-28] 这条消息的时间（epoch 毫秒），来自 ACP `update._meta.xg.ts`。 |
| `packages/core/src/runtimes/acp/api/models/turns/resource-links.test.ts` | 2 | * [XG-CUSTOM 2026-10-10] Schema tests for ACP-native `resource_link` rows. |
| `packages/core/src/runtimes/acp/api/models/turns/resource-links.ts` | 4 | * [XG-CUSTOM 2026-10-10] ACP-native `resource_link` rows. |
| `packages/core/src/runtimes/acp/api/models/turns/turn.ts` | 4 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `packages/core/src/runtimes/acp/api/reducer/decode.test.ts` | 2 | * [XG-CUSTOM 2026-10-09] Decoder + fold tests for agent-sent inline images. |
| `packages/core/src/runtimes/acp/api/reducer/decode.ts` | 26 | /** [XG-CUSTOM 2026-10-28] 从 ACP `_meta.xg.ts` 取消息时间；**只认有限数字**，其它一律 undefined。 */ |
| `packages/core/src/runtimes/acp/api/reducer/event-routing.ts` | 37 | // [XG-CUSTOM 2026-10-10] A resource link rides the active turn exactly like |
| `packages/core/src/runtimes/acp/api/reducer/ids.ts` | 48 | * [XG-CUSTOM 2026-10-10] Stable resource-link item id. |
| `packages/core/src/runtimes/acp/api/reducer/item-fold.ts` | 29 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `packages/core/src/runtimes/acp/api/transport.ts` | 40 | * [XG-CUSTOM 2026-11-02] OS pid of the spawned process, when the host can report it. |
| `packages/core/src/runtimes/acp/node/acp-test-support.ts` | 174 | /** [XG-CUSTOM 2026-11-02] Diagnostics sampled by the connection watchdog. */ |
| `packages/core/src/runtimes/acp/node/connection/acp-agent-connection.test.ts` | 225 | // [XG-CUSTOM 2026-11-02] initialize 死线 + stdio 自检（失败必须出声，不许静默挂住） |
| `packages/core/src/runtimes/acp/node/connection/acp-agent-connection.ts` | 31 | // [XG-CUSTOM 2026-11-02] **initialize 必须有死线 + 必须有"agent 到底说没说话"的证据。** |
| `packages/core/src/runtimes/acp/node/node/child-process-host.ts` | 48 | /** [XG-CUSTOM 2026-11-02] See AcpProcessHandle.pid. */ |
| `packages/core/src/runtimes/acp/node/runtime/conversation-handle.ts` | 277 | * [XG-CUSTOM 2026-11-03] Forget an eviction promise we can no longer await. |
| `packages/core/src/runtimes/acp/node/runtime/session-manager.ts` | 71 | // [XG-CUSTOM 2026-11-03] Budget for waiting on a pending conversation eviction before |
| `packages/core/src/runtimes/acp/node/runtime/session-materializer.ts` | 93 | // [XG-CUSTOM 2026-11-16] provider 不支持 loadSession 时**不要硬报错**。 |
| `packages/core/src/runtimes/acp/node/session/ocr-bridge.ts` | 1 | // [XG-CUSTOM 2026-10-30] 入站图桥：image 分片先经 8186 视觉模型转文字，再进 prompt。 |
| `packages/core/src/runtimes/agent-config/node/runtime/skills.ts` | 1 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `packages/core/src/runtimes/automations/api/deployment.ts` | 92 | // [XG-CUSTOM 2026-10-05] 事件触发配置：有它 = 这个部署由 webhook 触发（与 `schedule` 互斥） |
| `packages/core/src/runtimes/automations/api/run.ts` | 23 | // [XG-CUSTOM 2026-10-05] 加 `webhook`：事件触发跑出来的 run 要能和"手动点一下"区分开 |
| `packages/core/src/runtimes/automations/node/runtime.ts` | 42 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `packages/core/src/runtimes/automations/node/scheduling/scheduler.ts` | 118 | * 立即跑一次。[XG-CUSTOM 2026-10-05] 加了 `triggerKind` 入参： |
| `packages/core/src/runtimes/automations/node/scheduling/webhook-filter.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] **事件载荷过滤器**回归测试（webhook-filter.ts）。 |
| `packages/core/src/runtimes/automations/node/scheduling/webhook-filter.ts` | 1 | // [XG-CUSTOM 2026-10-05] **事件载荷过滤器 webhook-filter** —— 事件触发（webhook）的 `filter` 求值。 |
| `packages/core/src/runtimes/automations/node/scheduling/webhook-prompt.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] `promptTemplate` 渲染回归（webhook-prompt.ts）。 |
| `packages/core/src/runtimes/automations/node/scheduling/webhook-prompt.ts` | 1 | // [XG-CUSTOM 2026-10-05] **事件载荷 → prompt** 渲染（webhook 触发的 `promptTemplate`）。 |
| `packages/core/src/runtimes/automations/node/webhook-intake.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] **事件触发摄取端 ↔ 运行时**的端到端回归测试。 |
| `packages/core/src/runtimes/automations/node/webhook-server.test.ts` | 2 | // [XG-CUSTOM 2026-10-05] 事件触发**摄取端**回归测试（webhook-server.ts）。 |
| `packages/core/src/runtimes/automations/node/webhook-server.ts` | 1 | // [XG-CUSTOM 2026-10-05] **事件触发摄取端 automation-webhook-server**（第 3 项 · 第二切片） |
| `packages/core/src/runtimes/files/node/allocation/allocation-graph.ts` | 151 | // [XG-CUSTOM 2026-11-02] XG-LEASE-LABEL 文件路径（not-found 最可能来自这里） |
| `packages/core/src/runtimes/files/node/fs/file-system.ts` | 123 | // [XG-CUSTOM 2026-11-17] 并发/字节预算闸：打满就拒，绝不排队（排队正是放大的来源） |
| `packages/core/src/runtimes/files/node/fs/read-budget.ts` | 1 | // [XG-CUSTOM 2026-11-17] readText 并发 + 字节预算闸 |
| `packages/core/src/runtimes/workspace-registry/node/persistence/payload-codecs.ts` | 94 | // [XG-CUSTOM] 官方 v3：新增 previousScriptRuns（保留上次 script 结果，不参与创建身份）。 |
| `packages/core/src/services/runtime-broker/api/runtime-client-binding.ts` | 169 | // [XG-CUSTOM 2026-11-05] 透传挂起请求数（通道停滞看门狗的判据），本层不自己维护计数。 |
| `packages/core/vitest.config.ts` | 17 | // [XG-CUSTOM 2026-10-09] 让技能测试**封闭**：skills.ts 会按 EMDASH_CENTRAL_SKILLS_ROOT / |

## emdash-desktop（403）

| 文件 | 行 | 标记 |
|---|---|---|
| `apps/emdash-desktop/electron-builder.config.ts` | 12 | // [XG-CUSTOM 2026-10-11] 🔴 **版本号兜底（真机踩过）**： |
| `apps/emdash-desktop/electron.vite.config.ts` | 64 | // [XG-CUSTOM] zod 加进 exclude：monorepo hoist 把 zod 嵌套到 @emdash/core/node_modules， |
| `apps/emdash-desktop/package.json` | 200 | "xgCustomNote": "[XG-CUSTOM 2026-10-14] 版本 1.2.43-xiangwo：取图网格点击目标 page→orig 兜底（真机反馈「点了没图的框没反应」）；另 1.2.41 未设工作区回退、1.2.42 |
| `apps/emdash-desktop/release/package.json` | 101 | "xgCustomNote": "[XG-CUSTOM 2026-10-14] 版本 1.2.43-xiangwo：取图网格点击目标 page→orig 兜底（真机反馈「点了没图的框没反应」）；另 1.2.41 未设工作区回退、1.2.42 |
| `apps/emdash-desktop/scripts/xiangwo-orb-chat-harness.mjs` | 2 | // [XG-CUSTOM] 项我球聊天通道 harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/scripts/xiangwo-orb-history-harness.mjs` | 2 | // [XG-CUSTOM 2026-10-04] 项我球 **侧边枝历史拉回** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/scripts/xiangwo-orb-images-harness.mjs` | 2 | // [XG-CUSTOM] 项我球 **图片网格协议（xiangwo-images）** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/scripts/xiangwo-orb-mcp-harness.mjs` | 2 | // [XG-CUSTOM 2026-10-05] 项我球**MCP 工具市场卡** harness —— 跑**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/scripts/xiangwo-orb-question-harness.mjs` | 2 | // [XG-CUSTOM 2026-10-05] 项我球**提问卡** harness —— 渲染侧断言，跑的是**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/scripts/xiangwo-orb-selection-harness.mjs` | 2 | // [XG-CUSTOM] 项我球 **划词工具条** harness —— 用 **Playwright + 真实 Chrome** 跑**构建产物**（out/renderer）。 |
| `apps/emdash-desktop/src/core/features/agents/api/browser/components/agent-selector/agent-selector-options.ts` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/agents/api/browser/components/agent-selector/use-agent-availability.ts` | 25 | // [XG-CUSTOM] 远程 host（SSH 项目）：hostDependency 检测不支持远程 |
| `apps/emdash-desktop/src/core/features/agents/contributions/browser/agent-capability-icons.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/agents/contributions/browser/agent-selector.tsx` | 23 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/automations/browser/automation-run-format.ts` | 34 | // [XG-CUSTOM 2026-10-05] 事件触发（webhook）—— 加这个枚举值让 switch 重新穷尽 |
| `apps/emdash-desktop/src/core/features/automations/browser/builtin-catalog.ts` | 78 | // [XG-CUSTOM 2026-11-17] AF 待接日报：只读 + 落盘，不回复、不归档 |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationDetailView.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationRow.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationSettingsFields.tsx` | 1 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationTemplatesEmptyState.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationsBreadcrumb.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/AutomationsView.tsx` | 2 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] 中文化 |
| `apps/emdash-desktop/src/core/features/automations/browser/components/CreateAutomationView.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/KaneoBoardPanel.tsx` | 1 | // [XG-CUSTOM 2026-10-08] 「自动化」视图的 **Kaneo 看板** 面板 —— 现在是**系统图浏览**。 |
| `apps/emdash-desktop/src/core/features/automations/browser/components/RunHistory.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/WorkRallyPanel.tsx` | 1 | // [XG-CUSTOM 2026-10-10] 「自动化 → WorkRally 出图」Tab —— 用户要求把 WorkRally **并入「自动化」界面**， |
| `apps/emdash-desktop/src/core/features/automations/browser/components/pickers/UseTemplateButton.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/browser/components/xg-tab.test.ts` | 1 | // [XG-CUSTOM 2026-10-11] 回归：Tab 取值口径（纯函数）。 |
| `apps/emdash-desktop/src/core/features/automations/browser/components/xg-tab.ts` | 1 | // [XG-CUSTOM 2026-10-11] 「自动化」视图 Tab 的取值口径 —— **纯函数、零依赖**（可单测）。 |
| `apps/emdash-desktop/src/core/features/automations/browser/useAutomationFormState.ts` | 27 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/automations/contributions/views.ts` | 9 | // [XG-CUSTOM 2026-10-10] 用户原话：「**要结合集成与自动化，有些地方要到集成里调的话， |
| `apps/emdash-desktop/src/core/features/automations/node/deployment-builder.test.ts` | 235 | // [XG-CUSTOM 2026-10-05] 事件触发分支：webhook → schedule:null + webhook{token,filter,promptTemplate} |
| `apps/emdash-desktop/src/core/features/automations/node/deployment-builder.ts` | 10 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/browser/api/browser/browser-controls-registry.ts` | 6 | // [XG-CUSTOM] 2026-10-06 —— 复用开页：把「地址栏输入 URL 的那条导航路」（BrowserPane 的 |
| `apps/emdash-desktop/src/core/features/browser/api/browser/open-browser-tab.test.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「复用已有 browser 标签开页」的回归单测（根因： |
| `apps/emdash-desktop/src/core/features/browser/api/browser/open-browser-tab.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「在某个 task 里开一个内嵌浏览器页」的**复用判定 + 导航**（唯一落点）。 |
| `apps/emdash-desktop/src/core/features/browser/api/contract.ts` | 55 | // [XG-CUSTOM 2026-10-12] 「从零开页」的**回执**：主窗口渲染进程干完 `openEmbeddedBrowserTab` |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-pane.test.ts` | 200 | // ── [XG-CUSTOM] 2026-10-06 —— 早绑定（真机事故：页面开出来了却不在 /json/list）────── |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-pane.tsx` | 24 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-session-store.test.ts` | 3 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-start-page.tsx` | 2 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-tab-provider.tsx` | 7 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-toolbar-actions.ts` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-toolbar.tsx` | 46 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-bind.test.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 内嵌浏览器「早绑定」绑定器的单测（离线可复现）。 |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-bind.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-events.test.ts` | 391 | // ── [XG-CUSTOM] 2026-10-06 —— 早绑定钩子 ─────────────────────────────────────── |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-events.ts` | 12 | * [XG-CUSTOM] 2026-10-06 —— 早绑定钩子：在 `dom-ready` **之前**的每个可用时机都调一次 |
| `apps/emdash-desktop/src/core/features/browser/browser/browser-webview-types.ts` | 3 | // [XG-CUSTOM] 2026-10-06 —— 早绑定用的两个钩子（都早于 `dom-ready`）： |
| `apps/emdash-desktop/src/core/features/browser/browser/ensure-bot-browser-profile.test.ts` | 1 | // [XG-CUSTOM 2026-10-03] 「带 botId 开内嵌页 → 落到哪个 profile」的判据。 |
| `apps/emdash-desktop/src/core/features/browser/browser/ensure-bot-browser-profile.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/browser/browser/open-url-command.test.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— `browser.openUrl`（打开网址…）的纯逻辑单测。 |
| `apps/emdash-desktop/src/core/features/browser/browser/open-url-command.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（命令 id `browser.openUrl`）的**纯逻辑**（可离线单测）。 |
| `apps/emdash-desktop/src/core/features/browser/browser/open-url-modal.tsx` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址」输入框：`browser.openUrl` 命令在命令面板里被选中后弹的那个框。 |
| `apps/emdash-desktop/src/core/features/browser/contributions/browser.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— browser slice 的 modal 贡献（目前只有「打开网址」输入框）。 |
| `apps/emdash-desktop/src/core/features/browser/contributions/commands.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」命令（id `browser.openUrl`）。 |
| `apps/emdash-desktop/src/core/features/browser/contributions/palette.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 让「打开网址…」出现在 Ctrl+K 命令面板里（不额外造 UI 基础设施）。 |
| `apps/emdash-desktop/src/core/features/browser/contributions/settings.ts` | 15 | // [XG-CUSTOM] botId：与 xiangwo-agent 的 suagent/role id 同形（如 sxsj / chief-engineer） |
| `apps/emdash-desktop/src/core/features/browser/node/wire-controller.ts` | 17 | // [XG-CUSTOM 2026-10-12] 「从零开页」的回执（渲染进程 → 主进程）；见 api/contract.ts |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-chat-panel.tsx` | 18 | // [XG-CUSTOM] 项我 @ 专家补全清单（从 suagent_registry.py 生成） |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-chat-registry.ts` | 41 | /** [XG-CUSTOM] Return all stores across all tasks (for handoff target selection). */ |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-chat-resource-manager.ts` | 52 | /** [XG-CUSTOM] List all live stores in this task (for handoff target selection). */ |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-chat-store.ts` | 56 | // [XG-CUSTOM 2026-10-10] Resolve ACP `resource_link` URIs into chat-ui targets |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-live-session.ts` | 90 | // [XG-CUSTOM 2026-11-14] attach / ready 的死线必须大于「首轮全量扫描」的耗时。 |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/expert-handoff-bar.tsx` | 10 | * [XG-CUSTOM] 专家交接台横条：聊天输入框下面的一行，显示待接主题。 |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/resource-link-enrichment.test.ts` | 2 | * [XG-CUSTOM 2026-10-10] Tests for the desktop `resource_link` enrichment. |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/resource-link-enrichment.ts` | 2 | * [XG-CUSTOM 2026-10-10] Desktop enrichment for ACP-native `resource_link` rows. |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/xg-card-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-27] Dot 落卡详情 —— **改走 emdash 原生弹窗机制**。 |
| `apps/emdash-desktop/src/core/features/conversations/browser/acp/xiangwo-experts.ts` | 1 | // [XG-CUSTOM] 项我 @ 专家补全清单（从 suagent_registry.py 生成，改专家后重跑 _gen_xiangwo_experts_ts.py） |
| `apps/emdash-desktop/src/core/features/conversations/browser/conversation-agent-icon.tsx` | 3 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/conversations/browser/conversations-panel.tsx` | 27 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/conversations/browser/create-conversation-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/conversations/browser/expert-handoff-modal.tsx` | 12 | // [XG-CUSTOM] 专家交接平台：/use 切专家时弹「前专家产出主题」清单，用户可接下/删除。 |
| `apps/emdash-desktop/src/core/features/conversations/contributions/browser.ts` | 2 | // [XG-CUSTOM] 专家交接平台弹窗 |
| `apps/emdash-desktop/src/core/features/conversations/contributions/browser/conversation-transport-toggle.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/conversations/contributions/browser/sidebar-conversations-list.tsx` | 44 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/conversations/contributions/settings.ts` | 7 | // [XG-CUSTOM 2026-10-11] **默认必须是 `acp`（聊天），不能是 `pty`（终端）**。 |
| `apps/emdash-desktop/src/core/features/dev-perf/browser/DevProcessPanelModal.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/lsp/language-status.tsx` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/renderers/svg-renderer.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/task-editor/conflict-dialog.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/task-editor/file-content-search.tsx` | 30 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/task-editor/file-status-placeholder.tsx` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/task-editor/file-tab-item.tsx` | 19 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/browser/task-editor/file-tab-provider.tsx` | 34 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/editor/contributions/browser/editor-file-tree.tsx` | 81 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/expert-roster/browser/expert-roster-view.tsx` | 1 | // [XG-CUSTOM] 专家总览视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/expert-roster/contributions/browser.ts` | 1 | // [XG-CUSTOM] 专家总览视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/expert-roster/contributions/views.ts` | 1 | // [XG-CUSTOM] 专家总览视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/github/browser/github-integration-auth.tsx` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/github/node/services/octokit-provider.ts` | 5 | // [XG-CUSTOM] socks5 代理：GitHub API 走用户代理，解决国内直连 api.github.com 慢 |
| `apps/emdash-desktop/src/core/features/handoff/browser/handoff-view.tsx` | 1 | // [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/handoff/contributions/browser.ts` | 1 | // [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/handoff/contributions/views.ts` | 1 | // [XG-CUSTOM] 专家交接台视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/integrations/api/browser/integration-display.ts` | 3 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/integrations/browser/SetupFormShell.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/integrations/browser/device-sign-in.tsx` | 10 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/integrations/browser/integration-setup-modal.tsx` | 15 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/integrations/contributions/browser/provider-identity-strip.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/integrations/contributions/browser/standard-integration-auth.tsx` | 18 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/library/browser/prompts/prompt-library-view.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/library/browser/prompts/prompt-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/library/contributions/settings-page.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/machines/api/contract.ts` | 90 | // [XG-CUSTOM 2026-11-02] Idempotent 5 s poll. It must never queue while the |
| `apps/emdash-desktop/src/core/features/machines/browser/components/host-settings-card.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/components/link-conversation-modal.tsx` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/components/machine-conversations-list.tsx` | 18 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/components/machine-resources.tsx` | 2 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/components/machine-system-dependencies.tsx` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/components/workspaces-list-view.tsx` | 17 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/machine-authentication-fields.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/machine-connection-details.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/machine-form.tsx` | 10 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/machine-host-picker.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/machine-manual-fields.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/pages/local-workspaces-settings-page.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/pages/machine-details-page.tsx` | 55 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/pages/machines-settings-page.tsx` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/pages/system-settings-page.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/browser/use-machine-metrics.test.ts` | 8 | // [XG-CUSTOM 2026-11-02] 「资源面板在『有值』和『— / Unavailable』之间反复跳」的回归测试。 |
| `apps/emdash-desktop/src/core/features/machines/browser/use-machine-metrics.ts` | 8 | // [XG-CUSTOM 2026-11-02] 修「资源面板在『有值』和『— / Unavailable』之间反复跳」。 |
| `apps/emdash-desktop/src/core/features/machines/browser/use-system-dependencies.ts` | 15 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/machines/contributions/settings-page.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/McpCard.tsx` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/McpDrawer.tsx` | 19 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/McpServersList.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/McpToolbar.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/McpView.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/browser/components/SyncToAgentsSection.tsx` | 10 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/mcp/contributions/settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/preview-servers/node/port-forward-tunnel.ts` | 3 | // [XG-CUSTOM 2026-10-16] 端口回退要留痕（否则"空窗"只有失败日志、看不出真端口用了哪个）。 |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/add-project-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/content.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/location-selector.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/owner-selector.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/project-directory-picker.tsx` | 26 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/add-project-modal/untrusted-repository-notice.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/directory-selector-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/main-panel/active-project.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/main-panel/project-header.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/pr-view/pr-row.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/pr-view/pr-sync-status-card.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/pr-view/pr-view.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/project-error-details.tsx` | 3 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/relink-project-modal.tsx` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/rename-project-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/project-config-import-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/project-settings-footer.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/sections/base-project-settings-section.tsx` | 44 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/sections/shareable-project-settings-section.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/settings-panel.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/share-project-config-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/shareable-setting-title.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/settings-view/use-project-settings-form.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/task-view/task-list-empty-state.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/task-view/task-list.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/projects/browser/components/task-view/task-row.tsx` | 21 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/browser/project-availability-presentation.ts` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/projects/contributions/browser/use-confirm-delete-project.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/AgentIntegrationSection.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/AgentMcpSection.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/AgentsSettingsPage.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/AgentsToolbar.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/DefaultAgentSelector.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/DependencyInstallationStatusCard.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/DependencyInstallationUpdateCard.tsx` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/InstalledAgentContent.tsx` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/agents-page/installation-sources.ts` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/components/AccountTab.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/BrowserSettingsCard.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] 中文界面文案（zh i18n，详见 CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/settings/browser/components/FilesSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/HiddenToolsSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/IntegrationAccountsSection.tsx` | 10 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/components/IntegrationGridCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/IntegrationRow.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/components/IntegrationsCard.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/components/InterfaceSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/KeyboardSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/NotificationSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/RepositorySettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/ResetToDefaultButton.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/components/SettingsPage.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/SidebarMetadataSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/TaskSettingsRows.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/TelemetryCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/TerminalSettingsCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/components/ThemeCard.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/pages/browser-settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/pages/general-settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/pages/integrations-settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/pages/interface-settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/pages/repository-settings-page.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/browser/search/settings-search.ts` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/browser/settings-view.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/settings/contributions/browser/open-in-menu.tsx` | 16 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/settings/contributions/settings-pages.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/skills/browser/components/CreateSkillModal.tsx` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/skills/browser/components/SkillCard.tsx` | 30 | {/* [XG-CUSTOM 2026-10-09] 外部只读来源（中央库 / User 层）不提供装/卸按钮 —— |
| `apps/emdash-desktop/src/core/features/skills/browser/components/SkillDetailModal.tsx` | 15 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/skills/browser/components/SkillsList.tsx` | 7 | // [XG-CUSTOM] 技能分类清单（从 skills-central 归一化，_gen_skill_categories.py 生成） |
| `apps/emdash-desktop/src/core/features/skills/browser/components/SkillsToolbar.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/skills/browser/components/SkillsView.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/skills/browser/components/skill-categories.ts` | 1 | // [XG-CUSTOM] 技能分类清单（skills-central 归一化；首选本地模型打标缓存 技能分类-LLM缓存.json，关键词兜底；改技能后重跑 _gen_skill_categories.py） |
| `apps/emdash-desktop/src/core/features/skills/browser/components/useSkills.ts` | 12 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/skills/contributions/settings-page.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/source-control/browser/components/branch-selector.tsx` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/action-card.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/commit-card.tsx` | 19 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/checks-list.tsx` | 17 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/comments-list.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/commits-list.tsx` | 22 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/create-pr-modal.tsx` | 40 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/merge-footer.tsx` | 14 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/components/pr-entry/merge-ui-state.ts` | 3 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/git-status-section.tsx` | 17 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/pr-section.tsx` | 30 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/staged-section.tsx` | 22 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/changes-panel/unstaged-section.tsx` | 23 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/comments/comment-input.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/comments/comment-widget.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/diff-tab-item.tsx` | 14 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/diff-tab-provider.tsx` | 18 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/main-panel/diff-file-renderer.tsx` | 38 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/main-panel/diff-toolbar.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/main-panel/image-diff-view.tsx` | 19 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/browser/diff-view/main-panel/stacked-diff-view.tsx` | 21 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/source-control/contributions/browser/changes-panel.tsx` | 45 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/add-remote-modal.tsx` | 32 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/activity-badge.tsx` | 25 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/automation-run-pill.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/issue-selector/issue-selector.tsx` | 26 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/pr-selector/pr-selector.tsx` | 26 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/preview-servers/manual-forward-button.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/preview-servers/manual-forward-dialog.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/components/preview-servers/preview-server-pill.tsx` | 12 | // [XG-CUSTOM] 2026-10-06 —— 复用开页（同 profile 的已有 browser 标签 → 导航它，不叠新标签） |
| `apps/emdash-desktop/src/core/features/tasks/browser/context-bar/add-context-popover.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/context-bar/prompt-actions-menu.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal/create-task-modal.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal/linked-entity-section.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/tasks/browser/create-task-modal/task-name-field.tsx` | 2 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/main-panel.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/new-conversation-tab-button.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/pane-empty-state.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/tasks/browser/rename-task-modal.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-config/branch-name-field.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-config/branch-picker-field.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-config/existing-workspace-picker.tsx` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-config/new-worktree-panel.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-config/pr-new-branch-panel.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-scope.tsx` | 5 | // [XG-CUSTOM] 2026-10-06 —— 复用开页：`task.openBrowser`（人主动"新开浏览器"）显式关掉复用 |
| `apps/emdash-desktop/src/core/features/tasks/browser/task-titlebar.tsx` | 58 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/contributions/browser/project-selector.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/contributions/browser/task-config/initial-conversation-section.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/tasks/contributions/browser/task-config/workspace-settings-section.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/tasks/contributions/browser/task-context-menu.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/tasks/contributions/scopes.ts` | 2 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（browser.openUrl）：名字带 browser. 前缀（命令归 browser slice）， |
| `apps/emdash-desktop/src/core/features/terminals/browser/task-terminal/terminal-drawer-tab-bar.tsx` | 24 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/terminals/browser/task-terminal/terminal-tab-provider.tsx` | 29 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/terminals/contributions/browser/pty/terminal-search-overlay.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/terminals/contributions/browser/task-terminal/terminal-panel.tsx` | 27 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/usage/browser/usage-account-section.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/usage/browser/usage-overview-view.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/api/browser/embedded-browser-open-request.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] `pickTargetTask` 回归：**用户要看 → 开在用户眼前；agent 自用 → 维持隔离**。 |
| `apps/emdash-desktop/src/core/features/workbench/api/browser/embedded-browser-open-request.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/workbench/api/browser/open-external-link.ts` | 2 | // [XG-CUSTOM] 2026-10-06 —— 复用开页（同 profile 的已有 browser 标签 → 导航它，不叠新标签） |
| `apps/emdash-desktop/src/core/features/workbench/api/browser/task-composition.ts` | 69 | // [XG-CUSTOM] 2026-10-06 —— 可被「按 kind 找/激活标签」寻址的标签类别（与 activateLastTabOfKind 原签名一致）。 |
| `apps/emdash-desktop/src/core/features/workbench/browser/command-palette/command-palette-modal.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/workbench/browser/external-link-choice-dialog.test.ts` | 31 | // [XG-CUSTOM 2026-10-06] 组件已走 i18n（默认中文 `复制链接`）——原断言只认英文致测试恒失败。 |
| `apps/emdash-desktop/src/core/features/workbench/browser/external-link-choice-dialog.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/workbench/browser/feedback-modal/feedback-modal.tsx` | 23 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/feedback-modal/use-feedback-submit.ts` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/home-view.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/nav-buttons.tsx` | 6 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/onboarding/components/project-conflicts.tsx` | 8 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/onboarding/onboarding-shell.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/onboarding/sign-in-step.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/quit-unsaved-changes-dialog.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar-recovery-controls.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/left-sidebar.tsx` | 3 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/project-item.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/projects-group-label.tsx` | 1 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/sidebar-search-trigger.tsx` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/task-sidebar-agent-status.tsx` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/features/workbench/browser/sidebar/use-sidebar-drop.ts` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workbench/browser/unsaved-changes-dialog.tsx` | 4 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workspaces/contributions/browser/removal-attention-panel.tsx` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workspaces/contributions/browser/repository-header.tsx` | 13 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workspaces/contributions/browser/workspace-detail-page.tsx` | 46 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/workspaces/contributions/browser/workspace-pills.tsx` | 9 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/features/xg-console/browser/console-section.tsx` | 1 | // [XG 2026-11-19] 中控台在 Windows 客户端上用，localhost 指客户端自己 ⇒ 默认走服务端 LAN IP， |
| `apps/emdash-desktop/src/core/features/xg-console/browser/console-view.tsx` | 1 | // [XG 2026-11-19] 中控台在 Windows 客户端上用，localhost 指客户端自己 ⇒ 默认走服务端 LAN IP， |
| `apps/emdash-desktop/src/core/features/xg-console/contributions/browser.ts` | 1 | // [XG-CUSTOM 2026-11-17] 中控台视图注册 |
| `apps/emdash-desktop/src/core/features/xg-console/contributions/views.ts` | 1 | // [XG-CUSTOM 2026-11-17] 中控台视图（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/xiangwo/browser/xiangwo-view.tsx` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/xiangwo/contributions/browser.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/features/xiangwo/contributions/views.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/core/manifests/browser/browser-contributions.ts` | 2 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址」输入框（browser.openUrl 命令用） |
| `apps/emdash-desktop/src/core/manifests/browser/view-catalog.ts` | 6 | import { xiangwoViewDef } from '@core/features/xiangwo/contributions/views'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/manifests/shared/command-catalog.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（browser.openUrl） |
| `apps/emdash-desktop/src/core/manifests/shared/command-palette-catalog.ts` | 1 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址…」（browser.openUrl）进命令面板 |
| `apps/emdash-desktop/src/core/primitives/agents/browser/SudoRetryPanel.tsx` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/primitives/agents/browser/install-command-row.tsx` | 5 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/primitives/app-identity/api/app-identity.ts` | 13 | // [XG-CUSTOM 2026-10-11] 🔴 产物名**必须带版本**：原来只拼前缀 ⇒ 每次产物同名 |
| `apps/emdash-desktop/src/core/primitives/automations/api/config.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] trigger 配置的**语义校验**回归（config.ts 的 validateTriggerConfig / isWebhookTrigger）。 |
| `apps/emdash-desktop/src/core/primitives/automations/api/config.ts` | 6 | // [XG-CUSTOM 2026-10-05] **trigger 升 v2：cron \| webhook**（治"触发源只有 cron"） |
| `apps/emdash-desktop/src/core/primitives/automations/api/validation.ts` | 6 | // [XG-CUSTOM 2026-10-05] expr 在 webhook 触发里可为空 → cron 校验先判存在 |
| `apps/emdash-desktop/src/core/primitives/browser/api/browser.test.ts` | 207 | // [XG-CUSTOM] bot ⟷ profile：唯一真源 = botId。这些用例锁住三件事： |
| `apps/emdash-desktop/src/core/primitives/browser/api/browser.ts` | 3 | // [XG-CUSTOM] 项我 agent 请求「从零开一个内嵌浏览器页」：主进程没有任何已绑定的内嵌浏览器时 |
| `apps/emdash-desktop/src/core/primitives/desktop-host/api/host-contract.ts` | 66 | // [XG-CUSTOM] 专家交接平台 topic 数据模型 |
| `apps/emdash-desktop/src/core/primitives/desktop-host/browser/host-client.ts` | 3 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/core/primitives/telemetry/api/telemetry.ts` | 18 | // [XG-CUSTOM] 加 'xiangwo'（项我浮窗视图） |
| `apps/emdash-desktop/src/core/primitives/workbench-shell/browser/tabs/tab-bar/tab-context-menu.tsx` | 11 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/core/services/hosts/node/channel-stall-watchdog.test.ts` | 10 | // [XG-CUSTOM 2026-11-05] 通道停滞看门狗的假时钟测试。 |
| `apps/emdash-desktop/src/core/services/hosts/node/channel-stall-watchdog.ts` | 4 | * [XG-CUSTOM 2026-11-05] wire 通道停滞看门狗 —— SSH/wire 传输层。 |
| `apps/emdash-desktop/src/core/services/hosts/node/connection-supervisor.policy.test.ts` | 332 | // [XG-CUSTOM 2026-11-02] 「断开后要人手动点 Retry」的回归：自动重连必须是**有界**的 |
| `apps/emdash-desktop/src/core/services/hosts/node/connection-supervisor.stall.test.ts` | 10 | // [XG-CUSTOM 2026-11-05] 通道停滞 ⇒ 走既有「断开 + 重建」路径 的端到端回归。 |
| `apps/emdash-desktop/src/core/services/hosts/node/connection-supervisor.ts` | 7 | // [XG-CUSTOM 2026-11-05] oxfmt(sortImports) 把这一行从 @emdash/wire/rpc 之后归位到 shared 组； |
| `apps/emdash-desktop/src/core/services/hosts/node/host-runtime-connection.test.ts` | 16 | // [XG-CUSTOM 2026-11-05] 通道停滞回调（看门狗要它才装；本用例不断言停滞行为）。 |
| `apps/emdash-desktop/src/core/services/hosts/node/host-runtime-connection.ts` | 14 | // [XG-CUSTOM 2026-11-05] 通道停滞看门狗（判据/防抖/结构化日志都在那个文件里）。 |
| `apps/emdash-desktop/src/core/services/notifications/node/sqlite-store.ts` | 122 | // [XG-CUSTOM 2026-10-20] **`offset` 前面必须有 `limit`**（SQLite 语法）——原写法只给 `.offset()` |
| `apps/emdash-desktop/src/core/services/pull-requests/browser/pull-request-list-view.ts` | 7 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/entry/main.ts` | 3 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/entry/preload.ts` | 35 | // [XG-CUSTOM] CDP 桥接：截图当前浏览器标签页 / 拿当前标签页 URL（浮窗 📷 用）。 |
| `apps/emdash-desktop/src/main/bootstrap/boot/phases/background.ts` | 4 | // [XG-CUSTOM] 球的「图片卡片点击 → 开内嵌浏览器」把请求接回同一条开页广播 |
| `apps/emdash-desktop/src/main/bootstrap/boot/phases/prepare-electron.ts` | 3 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/main/bootstrap/boot/phases/services.ts` | 11 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/main/bootstrap/boot/wiring.ts` | 2 | import { browserEvents } from '@core/features/browser/node'; // [XG-CUSTOM] 内嵌浏览器「从零开页」广播 |
| `apps/emdash-desktop/src/main/core/app/service.ts` | 242 | // [XG-CUSTOM 2026-11-02] XG-COPY-ONCE：**不要**给菜单项挂全局 `CmdOrCtrl+C`。 |
| `apps/emdash-desktop/src/main/gateway/runtime-broker.ts` | 44 | // [XG-CUSTOM] 高延迟远程（SSH 异地，ping ~340ms）：首次获取 client 时等待 runtime 就绪， |
| `apps/emdash-desktop/src/main/host/browser/browser-profile-session.ts` | 1 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/main/host/browser/browser-webcontents-registry.test.ts` | 219 | // [XG-CUSTOM] 2026-10-06 —— 只读计数：给 9223 桥的超时文案分档用（`countPendingWebviews()`）。 |
| `apps/emdash-desktop/src/main/host/browser/browser-webcontents-registry.ts` | 162 | * [XG-CUSTOM] 内嵌浏览器 CDP 桥（main/host/browser/xiangwo-cdp-bridge.ts）的白名单来源： |
| `apps/emdash-desktop/src/main/host/browser/controller.ts` | 12 | // [XG-CUSTOM 2026-10-12] 「从零开页」回执的落地点 + 开成之后把主窗提上来（只在用户看不见时） |
| `apps/emdash-desktop/src/main/host/browser/embedded-browser-open-ack.test.ts` | 1 | // [XG-CUSTOM 2026-10-12] 「开页回执登记处」单测 —— 球里点链接为什么能拿到 `{ok:false, reason}`。 |
| `apps/emdash-desktop/src/main/host/browser/embedded-browser-open-ack.ts` | 1 | // [XG-CUSTOM 2026-10-12] 「球里点链接 → emdash 内嵌浏览器开页」的**回执登记处**（主进程侧）。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-bot-browser-profile.test.ts` | 1 | // [XG-CUSTOM] bot ⟷ 浏览器 profile 主进程侧解析单测。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-bot-browser-profile.ts` | 4 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-browser-proxy.test.ts` | 15 | describe('[XG-CUSTOM] resolveXiangwoBrowserProxy', () => { |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-browser-proxy.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器（per-profile session）的 socks5 代理解析。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-browser-relay-env.test.ts` | 1 | // [XG-CUSTOM 2026-10-02] 环境变量开关单测：老 exe（已发布、只有旧判据）的逃生路径。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-browser-relay.test.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器反向通道单测：只测"出站拨号 + 本地转发 + 结果回传"这套协议， |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-browser-relay.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器「反向命令通道」客户端（Windows/Linux 都跑，出站 only）。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-cdp-bridge.test.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器 CDP 桥单测。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-cdp-bridge.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器 CDP 桥：把 emdash 的 `<webview>` 内嵌浏览器以标准 Chrome DevTools |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-cdp-peers.test.ts` | 1 | // [XG-CUSTOM] CDP 桥「来源白名单」单测：CIDR 匹配 + 组网网段自动探测 + XIANGWO_CDP_ALLOW 覆盖。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-cdp-peers.ts` | 1 | // [XG-CUSTOM] 内嵌浏览器 CDP 桥的「来源白名单」：本机回环 + 自动探测的虚拟组网网段。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-cdp-ws.ts` | 1 | // [XG-CUSTOM] 极简 RFC6455 WebSocket 服务端（零新依赖，供内嵌浏览器 CDP 桥用）。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-relay-candidates.test.ts` | 1 | // [XG-CUSTOM 2026-10-02] 多候选地址 + 自动切换 单测。 |
| `apps/emdash-desktop/src/main/host/browser/xiangwo-relay-candidates.ts` | 1 | // [XG-CUSTOM 2026-10-02] 反向通道「**多候选地址 + 自动切换**」。 |
| `apps/emdash-desktop/src/main/host/chromium-command-line.test.ts` | 12 | // [XG-CUSTOM] 2026-10-06 —— `configureChromiumCommandLine()` 现在**先**加两个与平台无关的 |
| `apps/emdash-desktop/src/main/host/chromium-command-line.ts` | 1 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/main/host/chromium-doh.test.ts` | 2 | * [XG-CUSTOM] 2026-10-06 —— DoH 配制的 node 单测（纯函数 + 两条落地路径）。 |
| `apps/emdash-desktop/src/main/host/chromium-doh.ts` | 2 | * [XG-CUSTOM] 2026-10-06 —— 内嵌浏览器改用**我们自己的 DoH**（治假 AAAA `2001::1` 沉洞）。 |
| `apps/emdash-desktop/src/main/host/externalLinks.ts` | 38 | // [XG-CUSTOM 2026-10-16] 兜底由 allow 改 deny：**非 http(s)（`file:` / 相对路径 / |
| `apps/emdash-desktop/src/main/host/secrets/encrypted-app-secrets-store.ts` | 35 | // [XG-CUSTOM 2026-11-03] 密文解不开不应炸 boot：safeStorage 后端/钥匙环变化后旧密文必然解不开， |
| `apps/emdash-desktop/src/main/host/updates/update-service.test.ts` | 40 | // [XG-CUSTOM 2026-10-06] 定制版默认**禁用**自动更新；生命周期用例要覆盖开启后的行为，这里显式打开 |
| `apps/emdash-desktop/src/main/host/updates/update-service.ts` | 77 | // [XG-CUSTOM] 定制版**默认禁用**自动更新：本版是本地中文化+修复版，不追官方更新， |
| `apps/emdash-desktop/src/main/host/window.ts` | 2 | // [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json |
| `apps/emdash-desktop/src/main/host/xiangwo-chat-target.test.ts` | 21 | describe('[XG-CUSTOM] chatCompletionsEndpoint', () => { |
| `apps/emdash-desktop/src/main/host/xiangwo-chat-target.ts` | 1 | // [XG-CUSTOM] 项我球（orb）/ 旧浮窗的**聊天地址解析**（主进程唯一权威）。 |
| `apps/emdash-desktop/src/main/host/xiangwo-host-commands.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] 主界面「可被指挥命令」白名单的回归。 |
| `apps/emdash-desktop/src/main/host/xiangwo-host-commands.ts` | 1 | // [XG-CUSTOM 2026-10-05] **主界面「可被球 / agent 指挥」的命令白名单 —— 唯一事实源**。 |
| `apps/emdash-desktop/src/main/host/xiangwo-orb-api.test.ts` | 1 | // [XG-CUSTOM 2026-10-03] 球 API 的「图片卡片点击 → 内嵌浏览器」入口单测（`host.openEmbeddedBrowser`）。 |
| `apps/emdash-desktop/src/main/host/xiangwo-orb-api.ts` | 2 | import { isHostCommand, listHostCommands, requiresApproval } from './xiangwo-host-commands'; // [XG-CUSTOM 2026-10-05] |
| `apps/emdash-desktop/src/main/host/xiangwo-orb-menu.test.ts` | 1 | // [XG-CUSTOM] 项我球右键菜单「补齐项」的主进程单测：模型目录 / 换头像 / 划词开关 / 编辑动作。 |
| `apps/emdash-desktop/src/main/host/xiangwo-orb.test.ts` | 1 | // [XG-CUSTOM] 项我球「边缘停靠（dock）」主进程侧单测。 |
| `apps/emdash-desktop/src/main/host/xiangwo-orb.ts` | 3 | // [XG-CUSTOM] 项我控制球（orb）—— 独立置顶小窗：平时是一颗球，悬停展开成面板。 |
| `apps/emdash-desktop/src/main/host/xiangwo-script-runner.test.ts` | 32 | describe('[XG-CUSTOM] resolveXiangwoScriptPath', () => { |
| `apps/emdash-desktop/src/main/host/xiangwo-script-runner.ts` | 1 | // [XG-CUSTOM] 主机感知的"项我 CLI"执行器（侧边交接台 / 专家交接台等）。 |
| `apps/emdash-desktop/src/main/host/xiangwo-tool-target.test.ts` | 1 | // [XG-CUSTOM] 2026-10-16 工具窗口地址解析（**主机直连 → 隧道 → 本机**）单测。 |
| `apps/emdash-desktop/src/main/host/xiangwo-tool-target.ts` | 1 | // [XG-CUSTOM] 2026-10-03 工具窗口（WeKnora / AFFiNE / Kaneo / T8 / OpenViking）的**地址解析**（主进程唯一权威）。 |
| `apps/emdash-desktop/src/renderer/App.tsx` | 9 | // [XG-CUSTOM] 项我 agent「从零开内嵌浏览器页」（见该文件头注释） |
| `apps/emdash-desktop/src/renderer/XiangwoFloatingPanel.tsx` | 1 | // [XG-CUSTOM] 项我侧边聊天浮窗 —— 独立置顶小窗，拖到任意浏览器旁当「侧边聊天框」。 |
| `apps/emdash-desktop/src/renderer/app/app-shutdown-lifecycle.tsx` | 10 | import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/renderer/lib/i18n/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/renderer/lib/i18n/locales.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `apps/emdash-desktop/src/renderer/lib/modal/modal-error-boundary.test.ts` | 7 | // [XG-CUSTOM 2026-11-02] 弹窗局部错误边界：抛错只关弹窗 + Toast，不许把整页接管。 |
| `apps/emdash-desktop/src/renderer/lib/modal/modal-error-boundary.tsx` | 15 | * [XG-CUSTOM 2026-11-02] 弹窗的**局部**错误边界。 |
| `apps/emdash-desktop/src/renderer/lib/modal/modal-renderer.tsx` | 212 | {/* [XG-CUSTOM 2026-11-02] 弹窗内渲染抛错只关掉这个弹窗 + Toast，不再让 app 级 |
| `apps/emdash-desktop/src/renderer/main.tsx` | 1 | import './lib/i18n'; // [XG-CUSTOM] |
| `apps/emdash-desktop/src/renderer/orb/markdown.test.ts` | 1 | // [XG-CUSTOM 2026-10-10] 球面板 Markdown 渲染的**可证伪**验收（见 ./markdown.ts 的文件头）。 |
| `apps/emdash-desktop/src/renderer/orb/markdown.ts` | 1 | // [XG-CUSTOM 2026-10-10] 项我球面板的 **Markdown 渲染** —— 治「球侧回的正文有点乱，聊窗却不错」。 |
| `apps/emdash-desktop/src/renderer/orb/orb-attachments.test.ts` | 1 | // [XG-CUSTOM 2026-10-12] 球的「待发图片」队列验收（见 ./orb-attachments.ts 的文件头）。 |
| `apps/emdash-desktop/src/renderer/orb/orb-attachments.ts` | 2 | * [XG-CUSTOM 2026-10-12] 球的**待发图片队列** —— 先把图攥在手里，**打完字跟图一起发**。 |
| `apps/emdash-desktop/src/renderer/orb/orb-outbound.test.ts` | 1 | // [XG-CUSTOM 2026-10-12] 「球 → 主窗」单一入口的回归（意图 → 通道） |
| `apps/emdash-desktop/src/renderer/orb/orb-outbound.ts` | 1 | // [XG-CUSTOM 2026-10-12] **「球 → 主窗」单一入口**（意图 → 通道的唯一判定处）。 |
| `apps/emdash-desktop/src/renderer/orb/orb-to-bottom.test.ts` | 1 | // [XG-CUSTOM 2026-10-16] 球侧「**回到底部**」圆钮的**漂移守卫**。 |
| `apps/emdash-desktop/src/renderer/orb/orb.css` | 2 | * [XG-CUSTOM] 项我控制球样式 —— 移植自开源项目 mini-yifan/deepseek-harness-orb（MIT） |
| `apps/emdash-desktop/src/renderer/orb/orb.html` | 3 | [XG-CUSTOM] 项我控制球页面 —— 移植自开源项目 mini-yifan/deepseek-harness-orb（MIT） |
| `apps/emdash-desktop/src/renderer/orb/orb.js` | 1 | // [XG-CUSTOM 2026-10-10] **球气泡也渲染 Markdown**（治「球侧回的正文有点乱、聊窗却不错」）： |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-action.test.ts` | 1 | // [XG-CUSTOM] 2026-10-05 —— 动作块解析/执行回归（jsdom 无关，纯函数）。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-action.ts` | 1 | // [XG-CUSTOM] 2026-10-05 —— **球的「指挥主界面」动作块**（`[XG-ACTION]{…}[/XG-ACTION]`）解析 + 执行。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-chat.test.ts` | 39 | describe('[XG-CUSTOM] resolveXiangwoChatUrl', () => { |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-chat.ts` | 1 | // [XG-CUSTOM] 项我球（orb.js）/ 旧浮窗（XiangwoFloatingPanel.tsx）共用的**聊天通道工具**： |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-history.test.ts` | 1 | // [XG-CUSTOM 2026-10-04] 侧边枝历史拉回的回归测试。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-history.ts` | 1 | // [XG-CUSTOM 2026-10-04] 侧边枝历史「拉回」：球重开/换机器后不丢对话。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-images-legacy.test.ts` | 1 | // [XG-CUSTOM 2026-10-06] 旧标记 `[XG-IMG]…[/XG-IMG]` 兼容回归（用户报的"原始标记裸露"）。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-images.test.ts` | 1 | // [XG-CUSTOM 2026-10-03] 项我球**图片协议 xiangwo-images** 的回归测试。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-images.ts` | 1 | // [XG-CUSTOM 2026-10-10] **协议本体与语义已搬到 `@emdash/shared`**（球 + 主聊天窗共用一份， |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-mcp.test.ts` | 1 | // [XG-CUSTOM 2026-10-05] 项我球 **MCP 工具市场协议 xiangwo-mcp** 的回归测试。 |
| `apps/emdash-desktop/src/renderer/orb/xiangwo-mcp.ts` | 1 | // [XG-CUSTOM 2026-10-05] 项我球**MCP 工具市场协议 xiangwo-mcp** —— 协议解析 + 卡片渲染 |
| `apps/emdash-desktop/src/renderer/tests/browser/modal-catalog.test.ts` | 28 | // [XG-CUSTOM] 2026-10-06 —— 「打开网址」输入框（browser.openUrl 命令用） |
| `apps/emdash-desktop/tsconfig.node.json` | 17 | // [XG-CUSTOM] 中文化在 shared/api 层用了 @renderer/lib/i18n，node 配置需此别名 |

## plugins（19）

| 文件 | 行 | 标记 |
|---|---|---|
| `packages/plugins/src/agents/impl/deepseek/icon.ts` | 1 | // [XG-CUSTOM 2026-10-26] DeepSeek 图标（自绘示意，非官方 logo）—— 台账见 emdash/scripts/xg-custom/manifest.json |
| `packages/plugins/src/agents/impl/deepseek/index.ts` | 1 | // [XG-CUSTOM 2026-10-26] DeepSeek（dsh）—— 官方卖点③「自带 CLI agent」的第一个真接入样本 |
| `packages/plugins/src/agents/impl/native-acp.test.ts` | 58 | // [XG-CUSTOM 2026-10-26] DeepSeek（dsh）—— `dsh --profile acp` 是标准 ACP agent（10-26 实测握手通过） |
| `packages/plugins/src/agents/impl/xiangwo-babado/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-caiwuzongguan/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-ceo/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-chief-engineer/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-dayi/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-scout/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-shangcha/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-shuobo/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-sxsj/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo-yunyou/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo/acp-transform.ts` | 1 | // [XG-CUSTOM] 项我子代理 enrich（见 CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo/icon.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/impl/xiangwo/index.ts` | 1 | // [XG-CUSTOM] 项我定制（见 emdash/CUSTOMIZATIONS.md） |
| `packages/plugins/src/agents/registry.ts` | 1 | // [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json |
| `packages/plugins/src/skills/README.md` | 3 | [XG-CUSTOM 2026-10-28] 用户口径：「你可以按 emdash 原生机制改一下运行方式合过来」。 |
| `packages/plugins/src/skills/types.ts` | 4 | * [XG-CUSTOM 2026-10-28] skill 的形状 —— 借 pstack 的 SKILL.md 语义（name / description / 正文）， |

## shared（6）

| 文件 | 行 | 标记 |
|---|---|---|
| `packages/shared/src/index.ts` | 47 | // [XG-CUSTOM 2026-10-10] 图片协议（球 + 主聊天窗共用的**唯一事实源**）—— |
| `packages/shared/src/lifecycle.ts` | 28 | // [XG-CUSTOM 2026-11-02] XG-LEASE-LABEL 带上是哪条 lease（路径/根）： |
| `packages/shared/src/xiangwo-ask.ts` | 1 | // [XG-CUSTOM 2026-11-19] `xiangwo-ask` 协议：跟着 Prime Agent 的 ask_user 形状移植（形状借鉴，MIT）。 |
| `packages/shared/src/xiangwo-images.test.ts` | 1 | // [XG-CUSTOM 2026-10-10] 共享图片协议（`xiangwo-images`）的单元测试。 |
| `packages/shared/src/xiangwo-images.ts` | 1 | // [XG-CUSTOM 2026-10-10] 图片协议 **xiangwo-images** 与语义的**唯一事实源**（球 + 主聊天窗共用一份）。 |
| `packages/shared/src/xiangwo-run.ts` | 1 | // [XG-CUSTOM 2026-11-19] `xiangwo-run` 协议：聊天里显示"哪个专家在运行"。 |

## wire（16）

| 文件 | 行 | 标记 |
|---|---|---|
| `packages/wire/src/api/client.ts` | 68 | // [XG-CUSTOM 2026-11-02] `holdWhileDisconnected` is a per-call opt-out for |
| `packages/wire/src/api/connect.ts` | 33 | * [XG-CUSTOM 2026-11-02] Per-call opt-out of hold-while-disconnected. `false` |
| `packages/wire/src/api/connection-robustness.test.ts` | 141 | // [XG-CUSTOM 2026-11-02] The overflow policy changed: a full buffer now drops |
| `packages/wire/src/api/define.ts` | 22 | * [XG-CUSTOM 2026-11-02] Idempotent, read-only procedures set this to `false` |
| `packages/wire/src/api/hold-while-disconnected.test.ts` | 7 | // [XG-CUSTOM 2026-11-02] Proves the plumbing of `holdWhileDisconnected`: |
| `packages/wire/src/api/instrumentation.ts` | 85 | * [XG-CUSTOM 2026-11-02] A held call was dropped by FIFO eviction because the |
| `packages/wire/src/live/follower.ts` | 126 | // [XG-CUSTOM 2026-11-02] A delta that lands before the initial seed is not |
| `packages/wire/src/live/reconnect-sequence.test.ts` | 11 | // [XG-CUSTOM 2026-11-02] 「重启/断线后客户端要手动 Retry」的 wire 侧根因回归。 |
| `packages/wire/src/live/replica/job.ts` | 68 | // [XG-CUSTOM 2026-11-02] Idempotent resync read: fail fast instead of queueing. |
| `packages/wire/src/live/replica/log.ts` | 44 | // [XG-CUSTOM 2026-11-02] Idempotent resync read: fail fast instead of queueing. |
| `packages/wire/src/live/replica/state.ts` | 51 | // [XG-CUSTOM 2026-11-02] Resync refetch of an idempotent snapshot: never |
| `packages/wire/src/worker/link.ts` | 12 | /** [XG-CUSTOM 2026-11-02] Subscription to the process' own error channel. */ |
| `packages/wire/src/worker/node/child-process-spawner.ts` | 27 | // [XG-CUSTOM 2026-11-02] A worker that dies turns `send()` into EPIPE. Before |
| `packages/wire/src/worker/types.ts` | 34 | * [XG-CUSTOM 2026-11-02] Asynchronous IPC/process failures (EPIPE, |
| `packages/wire/src/worker/worker-ipc-failure.test.ts` | 18 | // [XG-CUSTOM 2026-11-02] P0 回归：一个 worker 死掉**不许**拖死宿主进程。 |
| `packages/wire/src/worker/worker-slot.ts` | 27 | // [XG-CUSTOM 2026-11-02] Bounded supervision ladder: 1 s / 2 s / 5 s / 10 s, |

## workspace-server（5）

| 文件 | 行 | 标记 |
|---|---|---|
| `apps/workspace-server/scripts/package.ts` | 56 | // [XG-CUSTOM] 不再用 Docker 构建 native 依赖（本机无 Docker），见下方 buildLinuxRuntimeDependencies |
| `apps/workspace-server/src/api/controller.ts` | 14 | // [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为） |
| `apps/workspace-server/src/index.ts` | 17 | // [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为） |
| `apps/workspace-server/src/wire/serve-socket.ts` | 10 | // [XG-CUSTOM 2026-11-05] 握手取证日志（只加日志，不改行为） |
| `apps/workspace-server/src/wire/xg-handshake-log.ts` | 2 | * [XG-CUSTOM 2026-11-05] 握手/就绪**取证日志**（服务端侧）—— 只加日志，不改行为。 |

