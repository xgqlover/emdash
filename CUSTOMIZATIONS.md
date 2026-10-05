# emdash 项我定制清单

> 所有定制代码带 `[XG-CUSTOM]` 标记，emdash 上游更新后用 `grep -rn "XG-CUSTOM"` 一键找回。
> emdash 上游：`github.com/generalaction/emdash`（Apache-2.0）

## 定制列表

### 1. i18n 中文化框架（新增）

- **文件**：`apps/emdash-desktop/src/renderer/lib/i18n/index.ts`（react-i18next 配置，默认中文）+ `locales.ts`（zh/en 语言包）
- **main.tsx**：加 `import './lib/i18n';`
- **依赖**：`i18next 26.4.2` + `react-i18next 17.0.13`（加在 emdash-desktop package.json）
- **关键符号**：`from '@renderer/lib/i18n'`、`t('`

### 2. 中文化文案（3 批，用 t() 替换硬编码英文）

- **左侧栏**：`projects-group-label.tsx`（项目/排序/添加）+ `left-sidebar.tsx`（自动化/设置/反馈/拖放）
- **主界面**：`home-view.tsx`（打开项目/创建仓库/从GitHub克隆/添加远程项目 + 描述）
- **task 界面**：`create-task-modal.tsx`（创建）、`task-name-field.tsx`（任务名）、`prompt-actions-menu.tsx`（折叠/展开）、`main-panel.tsx`（重试）、`rename-task-modal.tsx`（任务名不能为空）

### 3. 项我主对话 feature（新增）

- **目录**：`apps/emdash-desktop/src/core/features/xiangwo/`
  - `contributions/views.ts`（xiangwoViewDef）
  - `browser/xiangwo-view.tsx`（对话组件 + viewRuntime，fetch 8900/v1/chat/completions）
  - `contributions/browser.ts`（xiangwoBrowserContributions）
- **注册**：`core/manifests/browser/browser-contributions.ts`（加 xiangwoBrowserContributions.views）
- **左侧入口**：`left-sidebar.tsx`「🧠 项我」按钮（navigate(xiangwoViewDef())）

### 4. 项我 agent plugin（新增）

- **目录**：`packages/plugins/src/agents/impl/xiangwo/`
  - `index.ts`（CLIAgentPlugin：definePlugin + registerPluginBehavior）
  - `icon.ts`
- **注册**：`packages/plugins/src/agents/registry.ts`（加 import + 注册数组）
- **CLI 桥**：`xiangwo_cli.py`（五层四维根目录，调项我 8900）

### 5. 依赖变更

- `i18next` + `react-i18next`（emdash-desktop）

### 6. 子代理 enrich（专家 spawn → 原生 subagent 行，09-15）

- **新增** `packages/plugins/src/agents/impl/xiangwo/acp-transform.ts`：`enrichXiangwoUpdate`——把 `_meta.xiangwo.subagent=true` 的 tool_call 提升为 `kind:'subagent'` 事件（仿 claude 的 enrichClaudeUpdate）
- **改动** `packages/plugins/src/agents/impl/xiangwo/index.ts` + 9 个 `xiangwo-<bot>/index.ts`：`acp` 加 `enrich: enrichXiangwoUpdate`
- **agent 侧** `xiangwo_acp.py`：`send_subagent()` 函数，解析 `【EXPERT_SPAWN:xxx】` 标记 → 发 spawn-subagent tool_call + tool_call_update；`xiangwo-agent/agent.py` R2 专家管道返回带 `【EXPERT_SPAWN:{expert}】` 标记
- 效果：@bot /R2 派专家时，emdash 聊天窗原生显示「子代理行」（专家名 · 运行中/完成）

## 升级找回 SOP

1. `git pull` 上游 emdash
2. 冲突的文件：按本清单的「文件」列表逐个处理
3. `grep -rn "XG-CUSTOM" apps/emdash-desktop/src packages/plugins/src` 列出所有定制点
4. 新增 feature（xiangwo）+ plugin（xiangwo）是独立目录，上游更新不冲突，直接保留
5. 改动的现有文件（left-sidebar/home-view/task 等）：用 git diff 找回 [XG-CUSTOM] 标记处

### 7. lifecycle schema v3 兼容（future-version 根治，09-21）

- **文件**：`packages/core/src/runtimes/workspace-registry/node/persistence/payload-codecs.ts`
- **改动**：`storedLifecycle` 加 `.version('3', workspaceLifecycleSchema, upcast 透传)` + `serializeLifecyclePayload` 改 version '3' + parseVersioned 加 future-version 诊断日志（XG-DEBUG）
- **根因**：官方 09-16 `b995f4ac` 把 lifecycle schema 升 v3（新增 previousScriptRuns），fork 停在 v2 → 读官方 v3 数据报 future-version 崩溃
- **注意**：fork 的 workspaceLifecycleSchema 无 previousScriptRuns，zod 生产模式 strip 多余字段，读 v3 数据兼容（详见 OPS 二十四章）

### 8. 专家交接台 + 专家记忆隔离（09-22）

**交接台（emdash 前端，需打包 AppImage）**：
- `apps/emdash-desktop/src/main/host/window.ts`：`expertHandoffCall` 导出（spawn python3 expert_handoff.py list/accept/delete）
- `apps/emdash-desktop/src/main/bootstrap/boot/wiring.ts`：`hostOperations` 补 4 个 expertHandoff procedure（ByExpert/Accept/Delete/List），桥接 expertHandoffCall
- `apps/emdash-desktop/src/core/primitives/desktop-host/api/host-contract.ts`：`ExpertHandoffTopic` 接口 + 4 个 procedure 定义
- `apps/emdash-desktop/src/core/features/handoff/`：交接台 view（handoff-view.tsx 分组列表 + 状态徽章 + 时间 + Sheet 并入对话）
- `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-chat-registry.ts`：加 `listAll()`（列所有 ACP chat 供目标下拉）
- `left-sidebar.tsx`：「📥 交接台」按钮

**专家记忆隔离（后端 Python，重启服务生效，不需打包）**：
- `xiangwo-agent/agent.py`：`_suagent_log_turn`/`_suagent_history` 加 expert 参数（专家产出挂树带 expert_id + 回溯按专家过滤）
- `xiangwo_acp.py`：`call_xiangwo` 传 `[XIANGWO_SESSION=sid]`（session 隔离 + /use 专家映射 key）
- `suagent_registry.py`：补 `babado-legal`（w1x 独有专家，registry 缺失导致 @babado 自动匹配串到别的专家）
- `bots/babado-bot/agent-identities/soul-manifestos/babado-legal.md`：法务 manifest

**关键坑（升级找回必看）**：交接台走 wire RPC（`getHostClient().expertHandoffList` → `desktopHostContract`），主进程 handler 在 `wiring.ts` 的 `hostOperations`；window.ts 的 `ipcMain.handle('xiangwo:expert-handoff-list')` 是旧 ipc，前端不走。两个都要保留。

### 9. 交接台卡片化 + workspace-server fork 运行时（09-28）

**交接台 UI（前端，要打包 AppImage/exe 才生效）**：
- `core/features/handoff/browser/handoff-view.tsx` 重写为 UI kit 骨架：`PageLayout.Header` + `CollectionView layout="grouped"`（每个 `bot · 专家` 一块独立卡片，标题在卡片外）+ `CollectionToolbar`（搜索 / 计数 / 刷新 / **新建**）+ `createListView`（`source: async` + 文本搜索 + `sections` 分组）；行卡片对齐 `AutomationRow`（标题+状态徽章 左，bot·专家·时间 pill 右；第二行摘要 + 删除），点卡片开「并入对话」Sheet
- **去掉了「接下」按钮**（用户拍板）：同专家自己的会话记忆已覆盖；跨专家交接又需 `accepted_by`，而 UI 桥接 `expertHandoffAccept` 不带它 → agent 端 `consume_context` 按接手人过滤时永远跳过 → 按钮无实际作用
- ⚠️ **踩坑（改样式必看）**：主题只定义 `--em-accent-1`…`--em-accent-12` + `--em-accent-contrast`，**没有 `--em-accent`**。写 `bg-(--em-accent)` 会得到「白字无底 = 按钮隐形」（`新建`、`接下` 都中招过）。优先 `<Button variant="primary">`；非 Button 场景用 `bg-(--em-accent-9) text-(--em-accent-contrast)`
- `core/features/conversations/browser/acp/expert-handoff-bar.tsx`：聊天输入框下横条的「接下」同色修正（横条仍保留 接下/删除）

**workspace-server fork 运行时（后端，必须与桌面端同源，否则远程项目列不出 bot）**：
- `apps/workspace-server/scripts/package.ts`：`buildLinuxRuntimeDependencies` 由 `docker buildx` 改为**用打包好的 node 发行版直接 `npm install` 本地编译**（本机无 Docker），并在 staging 目录写 `.npmrc`（`allow-scripts=all`）；调用点改传 `nodeDistributionDirectory`（该补丁 09-26 官方升级 merge 时曾丢失，09-28 重新打上）
- **为什么必须自己编**：远程(SSH)项目的 bot 列表来自**主机端 runtime 的插件注册表**（`useAgents(host)` → `agentConfig.agents.list` live model）。官方频道下发的 runtime 不含 `packages/plugins/src/agents/impl/xiangwo*` → 列表空 → **SSH 连上也不能聊天**
- 协议版本必须与桌面端 `packages/core/src/workspace-server/versions/index.ts` 的 `PROTOCOL_VERSION` **同 major**（当前 `11.0.0`）；fork runtime 版本号要**大于官方频道版本**，否则会被频道指针降级覆盖
- 构建/部署/校验命令见 `emdash-运行经验-OPS.md`「workspace-server fork 版重编实做」节；配套探针在仓库外工作区：`scripts/workspace-server-wire-probe.ts`（协议/agent 列表/单 bot 依赖）、`scripts/acp-chat-probe.ts`（起停测试 ACP 会话）


### 10. [XG-CUSTOM] 桥接跟随主机（远端感知，09-29）

**问题**：`window.ts` 里的 `[XG-CUSTOM]` 桥接都是**主进程本地 spawn + 写死 Linux 路径**（`/usr/bin/python3`、`/persistent/home/xgqlover/...`）。
在 Linux 桌面上好用，在 **Windows 客户端**上必然失败 —— 典型表现：交接台显示 `读取交接台失败 检查 expert_handoff.py 桥接`（该文案是 UI 的 `errorSlot` 兜底，不是 Python 报错）。

**改法（恒定规则）**：桥接命令属于**被连接的那台主机**，不属于跑 UI 的机器。

- `kind === 'local'` → 本地 spawn（不要无脑走 ssh）
- `kind === 'remote'` → `ssh -o BatchMode=yes <user>@<host> "<bin> <转义后的参数...>"`
- 参数一律 shell 单引号转义（中文/空格/引号）
- **永远保留 `child.on('error', reject)`**，失败只能 reject，不能崩主进程
- 任何 `/persistent/home/xgqlover/...` 不许直接写进 spawn

统一走一个 `hostAwareSpawn(bin, args)` 执行器（实现见 `emdash-运行经验-OPS.md` 的「🌐 [XG-CUSTOM] 桥接必须跟着主机走」一节）。

**受影响**：

| 位置 | 桥接 | 状态 |
|---|---|---|
| `window.ts` 231/235 | 侧边交接台 `task-spaces.mjs` | ✅ 已改（2026-09-30，见第 11 节） |
| `window.ts` 265/270 | 专家交接台 `expert_handoff.py` | ✅ 已改（2026-09-30，见第 11 节） |
| `window.ts` 310/311 | Chrome / CDP | 已加 error 监听防崩，待统一 |

**验收**：Linux 桌面 + Windows 客户端**两边**都能读/新建/删除交接主题，且共用同一份 `xiangwo-agent/expert_topics.json`。

**改动文件**：`apps/emdash-desktop/src/main/host/window.ts`（改完按第十二节 SOP 重打 Windows 包）

---

## ⛔ 方向更正(2026-09-29 用户拍板)· 不要在 Windows 上改 emdash

> 用户原话:「win 上面的 emdash 的版本还是**半成品还在改进**的,所有改了 win 上的是**没用的**」

**因此,本文档中凡出现「重打 Win 包」「改 Win 客户端」「在 Win 上 patch app.asar / 加转发器」的做法,
一律作废。**正确落点只有一条:

| 项 | 正确做法 |
|---|---|
| 桥接 / 功能修复 | 改 **Linux 源码** `emdash/apps/emdash-desktop/src/main/host/window.ts`(及同类 `[XG-CUSTOM]` 处) |
| 出包 | 由 **Linux 侧正常打包流程**出包;**不为 Win 单独打补丁包** |
| Win 侧允许的改动 | 仅 OS 层面:网卡省电、SSH config、ZeroTier 客户端 —— **不碰 emdash 本体** |
| 禁止 | patch `app.asar`、改 Win 客户端配置、造 `C:\usr\bin\python3.exe` 之类的"补路径"垫片 |

**「hostAwareSpawn(桥接跟随主机)」这条方法本身仍然成立**,它描述的是**源码该怎么写**;
变的是**落点** —— 写在 Linux 仓库里,而不是改 Windows 上的产物。

(本条由 agent 于 20260929-235941 追加;原文未删除,保留作为排查记录。)

---

### 11. [XG-CUSTOM] 项我球（orb）远程主机三个断点（2026-09-30）

**问题**：球面板 / 旧浮窗把聊天地址写死 `http://127.0.0.1:8900`，Windows 客户端（远程主机）必然
`Failed to fetch`；8900 由 herdr 守护、重启有 ~15 秒空窗，用户只看到一句失败；交接台桥接写死
Linux 绝对路径（第 10 节遗留）。

**改动（全部 `[XG-CUSTOM]` 标记）**：

| 文件 | 作用 |
|---|---|
| `src/main/host/xiangwo-chat-target.ts`（新） | 聊天地址解析：`XIANGWO_AGENT_URL` → 本机 → SSH 端口转发 → 主机直连 → 不可达信号 → 异常回落 127.0.0.1；60s 缓存 + 并发去重 |
| `src/main/host/xiangwo-script-runner.ts`（新） | 主机感知 CLI 执行器（本机 spawn / 远程 `SshClientProxy.exec`）+ 人话错误 |
| `src/main/host/window.ts` | `taskSpaceCall` / `expertHandoffCall` 改用 runner；注册 `xiangwo:resolve-chat-url` |
| `src/bootstrap/boot/phases/services.ts` | 注入真实依赖（`sshConnections` 第一条 + `forwardManualPreview` + `ssh.manager.getProxy`） |
| `src/entry/preload.ts` | `electronAPI.resolveXiangwoChatUrl()` |
| `src/renderer/orb/xiangwo-chat.ts`（新） | 球/浮窗共用的地址解析 + 失败重试（1.5s/3s/5s，最多 3 次；4xx 与用户中止不重试）+ 文案 |
| `src/renderer/orb/orb.js` | 用解析地址替代写死常量；接重试与「后端启动中…（第 N 次重试）」 |
| `src/renderer/XiangwoFloatingPanel.tsx` | 同上（旧浮窗） |
| `src/main/host/browser/xiangwo-browser-proxy.ts`（新） | 内嵌浏览器代理解析：env → `userData/xiangwo-browser-proxy.json` → 非 Linux 缺省 `socks5://100.125.4.119:1080`；`off` 可关；坏值只记日志不崩 |
| `scripts/xiangwo-orb-chat-harness.mjs`（新） | 假桥 harness：跑**构建产物** `out/renderer`，断言地址来源/回落/重试/4xx/中止 |

**Windows 侧要配的两件事**（详见仓库根 `外地Windows连接emdash-操作指南.md`）：

1. 聊天地址：**不用配**（默认跟着 emdash 里那条 SSH 主机走；要覆盖就设 `XIANGWO_AGENT_URL`）。
2. 内嵌浏览器代理：优先 `XIANGWO_BROWSER_PROXY=socks5://100.125.4.119:1080`（启动项里设）；
   或干脆在 emdash 的 `userData` 放 `xiangwo-browser-proxy.json`：`{"proxy":"socks5://100.125.4.119:1080"}`
   （Windows = `%APPDATA%\Emdash\xiangwo-browser-proxy.json`；不用改快捷方式；`{"proxy":"off"}` = 直连）。
   非 Linux 客户端不配也有缺省值。**不需要改打包脚本**：打包产物本身不用带这个文件，可选项。

**验收**：`apps/emdash-desktop` 的 `pnpm run typecheck`（tsgo 三 project）EXIT=0、
`node --check src/renderer/orb/orb.js` EXIT=0、`npx oxlint` 无**新增** error（本 checkout 基线本来就是
104 error/25 warn：94 个来自缺失的 `tooling/oxlint/allowlists/core-boundaries.json`，其余为上游既有）；
`node scripts/xiangwo-orb-chat-harness.mjs` 15 项断言全过（跑构建产物 `out/renderer`）；
新增单测 48 项（`xiangwo-chat` / `xiangwo-chat-target` / `xiangwo-script-runner` / `xiangwo-browser-proxy`）。

**远程跑 node 的坑（已处理）**：主机的 node 是 nvm 装的，sshd 的非交互 `exec` 没有 nvm 的 PATH →
直接 `node <脚本>` 会 exit 127。runner 在「有 `remoteSearchPaths`」时改用 `execScript` 跑一段
小 shell（`command -v` → `"$HOME"/.nvm/versions/node/*/bin/node` → `/usr/local/bin/node` → `/usr/bin/node`
→ 都没有就 exit 127 + 人话错误）；argv 用 `quoteArg(posix)` 转义。已用干净 PATH 实测：
`env -i HOME=/home/xgqlover PATH=/usr/local/bin:/usr/bin:/bin /bin/sh <脚本>` → 正常返回交接台 JSON。

**同类遗留（本次未改，供后续决定）**：`src/core/features/xiangwo/browser/xiangwo-view.tsx:106` 还写死
`http://localhost:8900/v1/chat/completions`（项我主对话视图）。它属于 `src/core`，直接 import
`@renderer/orb/xiangwo-chat` 会撞 `emdash(core-host-boundaries)`（core 不许 import `@renderer/*`），
所以要么在该文件里本地实现同一套解析+重试，要么把公共逻辑下沉到 core。

---

## 📒 新版流程：改完代码 → 标记 → 跑 `--gen` 更新台账（2026-09-30 起）

本节只追加，不改上面别人的内容。**定制台账与检查器**（跟版时不用再靠记忆和人工 grep）：

- **台账（机器生成，禁手改）**：`scripts/xg-custom/manifest.json` —— 每个定制文件：标记数 / 行号 /
  **锚点指纹** / 内容 hash / 首次引入提交 / 最近变更提交 / 一句话说明。生成方式：`--gen`（幂等）。
- **检查器**：`scripts/xg-custom/check.mjs`
  ```bash
  node scripts/xg-custom/check.mjs --gen          # 重新生成台账（改完代码/补完标记就跑它）
  node scripts/xg-custom/check.mjs --check        # 漏标告警 + 台账时效 + 上游风险（有事项退出码 1）
  node scripts/xg-custom/check.mjs --list         # 打印台账（按文件分组 + 行号 + 说明）
  node scripts/xg-custom/check.mjs --after-merge  # 上游合并/rebase 之后跑：定制点丢了没有 + 从哪个提交捞回来
  ```
- **正本说明**：`scripts/xg-custom/README.md`（三件套为什么缺一不可、以标记为锚点/hash 只作辅助的取舍、
  升级上游标准流程、已知历史欠账清单）；运维速查见工作区 `emdash-运行经验-OPS.md` §十二。

### 12. [XG-CUSTOM] 专家总览视图（Pi 树全量身份，2026-10-02）

**定位**：Kaneo 只放「有工作」的 bot（A 方案），**全量身份可见性**放 emdash 侧边栏这个视图。
**用户决定（2026-10-02）：暂时留着**，看以后能改成什么 / 再改进（不删）。

⚠️ **当前局限（改的时候从这下手）**：它统计的"负载"来自 `expert_topics.json`（**交接池**），
不等于真实忙闲 —— 没交接 ≠ 闲着（专家可能在别的通道干活）。所以它现在更像"名册+交接分布"，
**不是负载监控**。要真有用，得换真实活动数据源（候选：Pi 树各分支最近写入时间 / agent 日志调用次数）。

**改动 5 处 + 1 个新 slice**：
| # | 文件 | 加什么 |
|---|---|---|
| 1 | `core/features/expert-roster/`（**新 slice**） | `contributions/views.ts`（`defineView({id:'expertRoster'})`）+ `contributions/browser.ts` + `browser/expert-roster-view.tsx` |
| 2 | `core/primitives/desktop-host/api/host-contract.ts` | `ExpertRosterEntry/ExpertRosterResult` 类型 + `expertRoster` procedure |
| 3 | `core/primitives/desktop-host/browser/host-client.ts` | `expertRoster()` |
| 4 | `main/host/window.ts` | `expertRosterCall()`（复用 `runXiangwoScript`，主机感知 → Windows 走 ssh） |
| 5 | `main/bootstrap/boot/wiring.ts` | 注册 `expertRoster: () => expertRosterCall()` |
| 6 | `core/manifests/browser/browser-contributions.ts` | 聚合新视图（**顺带给原有 xiango 注册补标**） |
| 7 | `core/features/workbench/browser/sidebar/left-sidebar.tsx` | 侧边栏「专家总览」入口（Users 图标） |

**数据源**：`xiangwo-agent/expert_roster.py roster`（只读 `suagent_registry.py` + `expert_topics.json`），
输出 81 身份（9 主 bot / 47 子代理 / 6 通用角色 / 19 专家池 + 未归类），按 kind 分组。

**升级找回**：`grep -rn "expertRoster\|expert-roster" apps/emdash-desktop/src`

### 13. [XG-CUSTOM] AFFiNE 集成卡片（知识工作台 3010，2026-10-02）

**背景**：用户报「设置→集成里看不到 AFFiNE」。查证：集成区此前只有 Kaneo/OpenViking/T8/WeKnora 四张卡，
**AFFiNE 从没在 emdash 接过**（只在 HippoBuddy 侧被 `_patch_hippo_canvas_affine.py` 指向过 3010）。

**照 Kaneo 模板改 5 处**：
| # | 文件 | 加什么 |
|---|---|---|
| 1 | `main/host/window.ts` | `createAffineWindow(url='http://127.0.0.1:3010')`（单例窗口，照 `createKaneoWindow`） |
| 2 | `main/bootstrap/boot/wiring.ts` | import `createAffineWindow` + handler `openAffine`（走 `services.forwardManualPreview(3010)`） |
| 3 | `core/primitives/desktop-host/api/host-contract.ts` | `openAffine` procedure |
| 4 | `core/primitives/desktop-host/browser/host-client.ts` | `openAffine()` |
| 5 | `core/features/settings/browser/components/IntegrationsCard.tsx` | import `openAffine` + 🧩 卡片（「知识工作台（文档 · 白板 · 表格，一体化编辑）」） |

**与内容侧的关系（别混）**：本卡片只是**打开 AFFiNE 窗口**（人看人用）；
AFFiNE 内容进 Pi 树靠 **`affine_ingest.py`**（Yjs 解码，见 `Kaneo-OPS.md`）。两者独立。

**升级找回**：`grep -rn "openAffine\|createAffineWindow" apps/emdash-desktop/src`

**新版流程（写进日常习惯）**：

1. 改 fork 代码时**一边改一边标** `[XG-CUSTOM]`（标记 + 一句话说明为什么改）—— 别攒着后面补；
2. `node scripts/xg-custom/check.mjs --gen`（新文件入账、标记数更新）；
3. `node scripts/xg-custom/check.mjs --check`（确认没有新漏标）；
4. **台账跟代码一起提交**（`git add scripts/xg-custom/manifest.json`）—— 台账和代码分开提交，
   下一次审计的基准就是错的。

**已知历史欠账**（不阻塞，供分批补）：`--check` 目前报 🔴 8 处「已入账文件里的漏标」+ 🟠 67 个「未入账文件」
（其中 65 个是中文化批处理时没打标记的组件，`import { t } from '@renderer/lib/i18n'` 是它们唯一的定制证据，
现在靠 `scripts/xg-i18n/manifest.json` 行级对照表兜着）。补法：在中文化 import 那行补 `// [XG-CUSTOM]` → `--gen`。


---

### 14. [XG-CUSTOM] bot ⟷ 浏览器 profile（每个 bot 一套 cookie/登录态，2026-10-03）

**要解决什么**：所有 bot 共用一个浏览器 = 共用一套 cookie。两个 bot 同时登同一个站点会互相顶下线，登录态还会串。

**唯一真源 = `BrowserProfile.botId`**（不给 bot 建反向表；派生映射 `~/.xiangwo/bot-browser-map.json` 只读重生，不反向写）。

**1:1 硬约束**：一个 bot 只能挂一个 profile（`bindProfileBot` 绑新的会自动把它从旧的摘掉），否则「开页时用谁的登录态」说不清。

**解析顺序**（`resolveBotBrowserProfileId`）：绑了 → 用它那个 profile；没绑 → 走「默认浏览器配置文件」（`Default` = 共享一套 / `isolated-per-task` = 每任务一套）。

**名册来源**：复用专家名册主机桥（`xiangwo-agent/expert_roster.py`，81 身份 = 9 主 bot / 47 子代理 / 6 通用角色 / 19 专家池）。
**用户 2026-10-03 拍板：只给 9 个主 bot 各绑一个 profile，子代理/专家不绑。**

**涉及文件**：`core/primitives/browser/api/browser.ts`（botId / 分区 id / 解析）、`main/host/browser/xiangwo-bot-browser-profile.ts`（派生映射）、`core/features/settings/browser/components/BrowserSettingsCard.tsx`（下拉 UI）、`core/features/browser/contributions/settings.ts`（schema + 分组头）、`browser-webcontents-registry.ts` / `browser-profile-session.ts` / `browser-tab-provider.tsx`（分区真正生效处）。

**验证**：Electron 40.10.2 / Chromium 144 实测三套分区（`persist:emdash-browser-profile` / `-bot-sxsj` / `-bot-babado`）cookie 互不可见；本地 `1.2.12-xiangwo` AppImage 实测设置页出现「未绑定 bot」下拉且名册可读（截图在桌面 `emdash-浏览器设置-bot下拉-20261003.png`）。

**升级找回**：`grep -rn "botId\|BROWSER_ISOLATED_PROFILE_ID\|resolveBotBrowserProfileId" apps/emdash-desktop/src | grep -i custom`

---

### 15. [XG-CUSTOM 2026-10-03] 工具窗口地址解析：隧道 → 主机直连 → 本机（修「外地客户端白屏」）

**要解决什么**：WeKnora / AFFiNE / Kaneo / T8 / OpenViking 五个窗口原来都是

```ts
const url = (await services.forwardManualPreview(port)) ?? 'http://127.0.0.1:<port>';
```

**Linux 上客户端 == 主机**，「回落地址」正好就是那台服务 ⇒ 回落也能用；
**Windows 客户端上 `127.0.0.1` 是客户端自己**（不是主机）⇒ SSH 隧道一失败窗口就白屏，看着像「功能没打包进 exe」。
（2026-10-03 AFFiNE 案实测：代码在包里 ✅、网络也通 ✅，白屏根因就是这个死地址 + 客户端未登录。）

**改法**：新增 `main/host/xiangwo-tool-target.ts`（照 `xiangwo-chat-target.ts` 已验证的范式：纯逻辑、不 import electron、带单测）。
解析顺序：① SSH 隧道 → ② `http://<主机>:<端口><path>` → ③ 本机 `127.0.0.1`（客户端 == 主机时）→ ④ **任何异常回落本机，永不抛**。
`bootstrap/boot/phases/services.ts` 注入 `resolveToolWindowUrl(remotePort, path?)`（复用 `firstRemoteHost` + `forwardManualPreview`）；
`bootstrap/boot/wiring.ts` 五个调用点改成一行 `await services.resolveToolWindowUrl(...)`。

**为什么"直连主机"是对的**：这些服务在主机上都监听 `0.0.0.0`；实测外地 Windows 经 ZeroTier 直连
`3010 / 9037 / 5180 / 18766` → **200**、`1933` → 302、`8900` → 404（= 活着，只是路径不对），WebSocket 握手 **101**。

**涉及文件**：`main/host/xiangwo-tool-target.ts`（新）、`main/host/xiangwo-tool-target.test.ts`（新）、
`main/bootstrap/boot/phases/services.ts`、`main/bootstrap/boot/wiring.ts`。

**验证**：`vitest run src/main/host/xiangwo-tool-target.test.ts` → **14 passed**（含 隧道 null / 抛错 / 超时 → 直连主机、IPv6 方括号、loopback 回落、异常不抛出）；
`tsgo --noEmit -p tsconfig.node.json` → **exit 0**。

**⚠️ 要重新打包才在 Windows 生效**（旧 exe 行为不变：隧道不通即白屏）。网络侧结论已写进
`NAS与网线OPS.md` 第十三节。

**升级找回**：`grep -rn "resolveToolWindowUrl\|computeToolWindowTarget" apps/emdash-desktop/src`

---

### 16. [XG-CUSTOM 2026-10-04] 侧边枝历史拉回（球重开/换机器不丢对话）

**要解决什么**：侧边**一直在写**侧边枝（`agent.py` 的 `_suagent_log_turn(..., source="sidebar")`，
`agent.py:4618/4619`），后端 `GET /sidebar/history?bot=&session_id=` 也**一直实现着**
（`agent.py:9448` → `_sidebar_history_json` `agent.py:4765`），但 **emdash 前端从没调用过它**（0 命中）
→ 球的会话只活在 localStorage，**清缓存/换机器就全丢**（用户原话「侧边也没有重新记忆」）。

**改法**：新增 `renderer/orb/xiangwo-history.ts`（纯逻辑：拼 URL / 规范化 / 取数，**永不抛**，基址为空就返回空串不发请求）；
`orb.js` 加 `restoreFromBackend(botId)` + `hasLocalMessages(botId)`，由 `switchBot()` 触发；
常量 `HISTORY_RESTORE_TIMEOUT_MS = 8000`。规则保守优先：
① 本地已有消息 → 不覆盖（本地是权威）② 默认 bot（空串「项我」）→ 直接跳过（后端没有它的侧边枝）
③ 拉到空 / 拉取失败 → 静默降级（不提示、不打断）④ 拉的期间用户切走 → 丢弃本次结果。

**⚠️ 判据是「有没有"有内容"的会话」而不是「桶里有没有条目」** —— `startConversation()` 会把一条**空**会话
立刻写进桶，用后者会导致换机器时永远判成"本地已有"，**永远不恢复**。

**涉及文件**：`renderer/orb/xiangwo-history.ts`（新）、`renderer/orb/xiangwo-history.test.ts`（新）、
`renderer/orb/orb.js`（import + 常量 + 两个函数 + `switchBot` 里一次调用 + trace）、
`scripts/xiangwo-orb-history-harness.mjs`（新）。

**验证**：`vitest run src/renderer/orb/` → **67 passed**（18 新）；
`tsgo --noEmit -p tsconfig.browser.json` → **exit 0**；
`node scripts/xiangwo-orb-history-harness.mjs`（需先 `pnpm run build:renderer`）→ **17/17**（4 场景：空桶拉回 / 本地有内容零请求 / 默认 bot 零请求 / 拉取抛错静默降级）；
真后端实测 `GET /sidebar/history?bot=sxsj` → **50 条**真数据。
**侧线回归**：B 线 `xiangwo-orb-images-harness.mjs` 仍 **47/47**（⚠️ 它要跑 5 分钟以上，别误判成卡住）。

**⚠️ 为什么必须用 harness 验**：恢复分支只在「本地桶为空」时触发，而球的 UI **没有删除会话入口**，
真机上造不出这个前置条件 → GUI 走不到这条分支。

**升级找回**：`grep -rn "restoreFromBackend\|xiangwo-history\|history-restore" apps/emdash-desktop/src apps/emdash-desktop/scripts`

### 17. [XG-CUSTOM 2026-10-05] 球浮窗三补丁（多屏重夹 / 捕获排除）+ 提问卡三语义（上限 / 预选 / 记忆）

**要解决什么**（两条线汇到一起：开源调研 + 当天实测）
1. **多屏/DPI**：上游 orb **没有任何 display 事件监听**（2026-10-05 实测 `getAllDisplays|display-added|
   display-removed|display-metrics-changed` 在它的 `floating-window.ts` 与 `main.ts` 里 **0 命中**，只用
   `getDisplayNearestPoint`）→ **拔掉球所在的那块屏之后，球留在已经不存在的坐标上**（用户看不见球，
   只能删 `xiangwo-orb.json` 救）。这是我们可以**反超**上游的点。
2. **屏幕捕获**：球是常驻置顶浮窗 → 任何截屏/录屏都会把它拍进去（包括 agent 自己的截图工具）。
3. **提问卡**：选项是模型即兴生成的；**没有多选上限**（挑风格能勾满 12 个）、**没有预选/记忆**
   （每次都要从头点）—— 而 `assistant-ui` 的 `option-list.tsx` 早就把 `defaultValue` + `maxSelections`
   定成语义了（MIT，抄语义不引库）。

**改法**
1. `main/host/xiangwo-orb.ts`：新增 `orbBallOrigin()`（窗口 bounds + 窗口内锚点 = 屏幕坐标球原点）+
   `reclampOrbForDisplays(reason)` —— **停靠态**按新屏幕 `bounds` 重算细条（细条贴屏幕真边）／
   **球态** `clampBall` 夹回最近 work-area + `saveOrbState` 写回位置记忆／**展开态**只保证整窗在工作区内
   （不动球锚点，避免面板锚错角）。建窗时注册 `screen.on('display-added'|'display-removed'|
   'display-metrics-changed')`，**250ms 防抖**（`display-metrics-changed` 一次改分辨率会连发），
   `closed` 时注销（模块级 `removeDisplayGuards`，防重复注册/泄漏）。
2. 同文件：win32/darwin 上 `setContentProtection(true)`（Windows `WDA_EXCLUDEFROMCAPTURE`；macOS
   `NSWindowSharingNone`；**Linux 不支持** → 平台守卫 + try/catch + trace）。
   ⚠️ 代价是**用户自己的录屏里也看不到球** —— 这是"不挡别人画面"的预期取舍。
3. `renderer/orb/orb.js`：`normalizeQuestion` 解析 `maxSelections`（上限）与 `defaultValue`
   （别名 `default`/`preselect`，**只接受 options 里确实存在的 label**，防脏数据造出幽灵已选项）；
   多选点击**到顶后忽略 + 出「最多选 N 项（先取消一个再选）」**（不静默吞点击）；`draftState` 预选优先级
   = agent 显式 `preselect` > **上次记忆**；`submitAll` 写入 `localStorage['xg-question-memory']`
   （按问题 id，最多 60 条，隐私模式/配额失败静默）；`agent.py` 的 `_XG_QUESTION_CARD_INSTRUCTION`
   补上两个字段的用法说明（模型才知道能用）。
4. 测试基础设施：`xiangwo-orb.test.ts` 的 `electron.screen` **mock 补 `on`/`removeListener`**（真实 Electron
   一定有；不补的话新监听一注册就把 28 个用例全带崩）+ 新增 2 条回归用例。

**涉及文件**：`main/host/xiangwo-orb.ts`、`main/host/xiangwo-orb.test.ts`、`renderer/orb/orb.js`、
`scripts/xiangwo-orb-question-harness.mjs`（新）、`CUSTOMIZATIONS.md`；agent 侧
`xiangwo-agent/agent.py`（在记忆系统仓）。

**验证**：`vitest run src/main/host/xiangwo-orb.test.ts` → **30 passed**（2 新）；
`tsgo --noEmit`（browser+node+scripts 三个项目）→ **exit 0**；`oxfmt --check` → clean；
五个渲染侧 harness 串行跑 → **156 项断言 0 失败**（chat 44 · history 17 · images 47 · selection 39 ·
**question 9/9 新写**，后者跑的是 `pnpm run build:renderer` 的产物）。
⚠️ 提问卡此前是**唯一没有测试**的卡片（chat/history/images/selection 都有 harness），第 4 条 harness 就是补这个洞。

### 18. [XG-CUSTOM 2026-10-05] 球上的 MCP 双卡：写操作**审批卡** + **工具市场卡**

**要解决什么**（两条都是"看得见/有得选"）：
1. **写类 MCP 工具一刀切拒绝**：只读档下调 `mcp_call` 调写类工具，`_perm_check_tool()` 只回一句
   "请把面板权限切到工作区内修改" —— 用户**没有任何选择**（要么去改全局档位，要么放弃）。
   而球上明明有**提问卡**（选项 + 推荐徽标 + 作答回传），写操作审批正是它该用的地方。
2. **58 个工具没有任何"一眼看全"的地方**：配置要手改 `~/.xiangwo/mcp.json`，工具要靠 `mcp_list`
   现查（日志 27 次），调用统计当天才补上（P0-1 留痕）。对照 OpenHands `features/mcp-page/`
   （installed-server-card / mcp-server-health / save-as-secret-toggle + `mcp-section-filter.ts` 分面过滤）。

**改法**
1. **审批卡**（`xiangwo-agent/xg_mcp_approval.py`，agent.py 只加 4 处薄接线）：
   - 复用手搓提问卡协议承载审批语义（**抄 assistant-ui approval-card 的语义，不引库**）：
     四态/影响面 → 我们用"选项 + detail 摊开 `服务器·工具·参数·为什么`"表达；
   - **安全核心：审批只对那一个 `server.tool` 生效** —— 选项文字里带完整 key
     （`批准执行一次：openviking.write`），回传时按 key 精确授予，**批准 A 不能授权 B**；
   - 两种力度：`批准执行一次`（用完即弃）/ `总是允许`（本进程会话内有效）；
   - 解析失败 = **不授予**（安全侧失败，宁可再问一次）；`danger-full-access` 档不生效（保持"完全"语义）；
     workspace-write 档只对写类动作二次确认（`XIANGWO_MCP_APPROVE_WORKSPACE=0` 可关）。
2. **工具市场卡**（新协议 `xiangwo-mcp`）：
   - agent 侧 `xiangwo-agent/xg_mcp_market.py` 生成块：服务器 / 传输 / 目标 / 健康 / 工具数 /
     写类工具 / 调用统计（来自 `xg_mcp_tools` 的留痕）/ **密钥只回显键名**（值在 agent 侧脱敏）；
   - 渲染侧 `renderer/orb/xiangwo-mcp.ts`（解析 + 卡片 + **分面过滤**：一个输入框同时过滤服务器名与工具名）
     + `orb.css` 样式 + `orb.js` 接线（解析链：images → **mcp** → question）+ 右键菜单「MCP 工具市场」；
   - 数据全部来自**已有真源**，不造第二份；默认用目录缓存（**不阻塞**），要现场枚举才 probe。

**涉及文件**：`renderer/orb/xiangwo-mcp.ts`（新）、`xiangwo-mcp.test.ts`（新）、`orb.js`、`orb.css`、
`main/host/xiangwo-orb-api.ts`（动作类型 + 菜单项）、`scripts/xiangwo-orb-mcp-harness.mjs`（新）；
agent 侧（记忆系统仓）：`xg_mcp_approval.py`、`xg_mcp_market.py`、`agent.py`、`tools_registry.py`。

**⚠️ 踩坑记录（加工具必须改两张表）**：`tools_registry.py` 里加了 `TOOLS`（描述/参数）**还不够** ——
`TOOL_CATEGORIES`（场景过滤表）没登记 → 被 `should_list` **静默滤掉**，模型回答"我没有 mcp_market 这个工具"。
再加 `_PERM_READONLY_TOOLS`（只读档白名单）没加 → 出卡前被"只读档"拦。**两处都补上才生效**（实测各卡一次）。

**验证**：`vitest run src/renderer/orb/xiangwo-mcp.test.ts` → **15 passed**；
`node scripts/xiangwo-orb-mcp-harness.mjs`（需先 build:renderer）→ **15/15**（含 ★解析链回归：同一条消息里
市场块 + 提问块 → 两张卡都渲染、正文两块都摘掉）；提问卡 harness **9/9** 回归；`tsgo --noEmit -p tsconfig.browser.json` → exit 0；
agent 侧端到端：read-only 档调写类工具 → **出审批卡**（`要执行 openviking.forget 吗？` + 影响面 + 三选项），
带回 `批准执行一次：openviking.forget` → 日志 `[MCP 审批] 已授予 once:…` → **工具真被执行**（留痕 `openviking.forget 756ms 226B`）；
市场卡实测返回 **3 服务器 / 58 工具 / 写类 17 / 调用 2 次**（密钥只键名）。

### 19. [XG-CUSTOM 2026-10-05] automations 触发源扩到 `cron | webhook`（第 3 项 · 第一切片）

**要解决什么**：实测 emdash 的 automations **只支持 cron**（`triggerConfig={expr,tz}`、
`triggerKind:'cron'|'manual'`），OpenHands 那边是 `AutomationTrigger{type,source,on,filter}`（事件触发 +
**JMESPath payload 过滤**）。这是调研里 emdash 唯一真实的能力缺口（其余如"运行错误留痕"我们反而更强）。

**这一轮落了什么（可独立验证的地基）**
1. **触发源 v2**（`primitives/automations/api/config.ts`）：`kind?: 'cron'|'webhook'`（**缺省=cron**）
   + `token` / `filter` / `promptTemplate`。**形状有意不用判别联合**：判别联合会丢掉输出类型里的
   `expr`/`tz`，连累 8 个既有调用点报 TS2339；现在**旧数据与旧写入方零改动**（实测 automations 57 项测试全过）。
   **不需要 SQL 迁移**（版本号/形状都在 JSON 列里）。
2. **事件载荷过滤器**（新 `scheduling/webhook-filter.ts` + 12 项测试）：自写**极小表达式语言**
   （路径/数组下标 + `== != contains startsWith endsWith exists notExists` + `&&`/`||`），
   **不用 eval、不引依赖**；**空 filter=全匹配**，**解析失败=不匹配（fail-closed）**，
   注入样本（`constructor.constructor`、`__proto__`、模板串）一律只是"不匹配"，不抛不执行。
3. **run 触发来源加 `webhook`**（`api/run.ts`）+ **`scheduler.runNow(deployment, 'manual'|'webhook')`**
   —— 事件摄取将与"手动点一下"走**同一条造 run 的路**，但来源可区分（排查第一问就是"谁触发的"）。

**验证**：`packages/core` automations **95 passed**（含 webhook-filter 12）；app 侧 automations **57 passed**
（13 文件，含 `main-db` 的迁移/投影测试 ⇒ 旧行不受影响）；`tsgo --noEmit` browser **0 错误** / node **0 错误**。

**⚠️ 明确没做的（下一轮）**：**摄取端**（localhost webhook 监听 + token 校验，照 `TuiHookServer` 姿态）、
**部署路径**（webhook 触发不该排 cron 计划，应直接 `runNow(..., 'webhook')`；目前 `deployment-builder`
兜底空 expr → 被 `cron_invalid` 明确拒绝，不会静默排假计划）、**UI**（表单里选触发源 + 显示 token/URL）。
这三件都要先定**端口与开关策略**（默认关、固定端口还是临时端口），属安全取舍，留给用户拍板。
