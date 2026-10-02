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

