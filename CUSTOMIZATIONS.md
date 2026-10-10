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

### 19b. [XG-CUSTOM 2026-10-05] 事件触发**摄取端**（第 3 项 · 第二切片）

**落了什么**：`packages/core/src/runtimes/automations/node/webhook-server.ts` —— 只做"把 HTTP 事件安全收进来
+ 过滤 + 回调"，**不碰调度、不碰数据库**（命中后由调用方去 `scheduler.runNow(deployment, 'webhook')`）。

安全姿态（照抄仓库既有 `TuiHookServer` + 每 automation 一个 token）：
① **只绑 127.0.0.1**；② **没有 webhook automation 就根本不起监听**（`ensureStarted()` 返回 null，不白占端口）；
③ **token 常量时间比较**（长度不同也不抛）；④ 路径/方法不对 404、缺 token 401、token 错或 id 未知 403
（不暴露"id 存不存在"）、坏 JSON 400、body 超 1MB 413；⑤ 过滤不匹配 **204（收到但不跑）**、命中 **202**。

**端口策略（本切片定，可覆盖）**：默认 `127.0.0.1:7823`，`EMDASH_AUTOMATION_WEBHOOK_PORT` 可改。
选固定端口的理由：外部脚本 / git hook 要能把地址写死；只绑 loopback + token 已足够防本机误触发。

**踩坑**：超体积时**不能 `req.destroy()`** —— 立刻断开会变成 `UND_ERR_SOCKET: other side closed`，
客户端根本拿不到那个 413（仓库既有的 `TuiHookServer` 就是 destroy，同款症状）。改成"回完 413 继续排空请求体"。

**验证**：`webhook-server.test.ts` **8/8**（真起服务器 + 真 HTTP：路由/鉴权/体积/格式/命中/过滤不匹配与
**畸形表达式都 204 不回调**/目标清空自动停/stop 后连不上）；`packages/core` automations **103 passed**；
`pnpm run typecheck`（core）**0 错误**；oxfmt 干净。

**还差（下一轮）**：把摄取端**接进运行时** —— `deploy` 输入带上 `trigger`（kind/token/filter），
runtime 在 `reconcile()` 里维护 token→automation 映射并调 `AutomationWebhookServer.ensureStarted()`；
以及 **UI**（表单选触发源 + 显示 token/URL）。

### 19c. [XG-CUSTOM 2026-10-05] 事件触发**接进运行时**（第 3 项 · 第三片，端到端可用）

**改动**（四两拨千斤，`.schedule` 全仓只有 5 处读取点，都在 scheduler）：
1. `api/deployment.ts`：`schedule` 改**可空**（`null` = 不是 cron 触发）+ 新增 `webhook:{token, filter?}`。
   两形状互斥；`automationRunConfigSnapshotSchema` 跟着可空（webhook run 的快照本来就没有计划）。
2. `scheduling/scheduler.ts`：`createScheduledRun` 遇 `schedule === null` **直接跳过**
   （**不排假计划**）；"重新部署导致计划变化"的比较也先判空。
3. `node/runtime.ts`：
   - `deploy()` **按触发源分开校验**：cron 验表达式；webhook 验**过滤表达式**（`parseWebhookFilter`，
     非法直接拒 —— 不给"看起来能跑其实永远不触发"的配置）；
   - 新增 `webhookTargets()`（来自 `listEnabledDeployments()`，只含有 webhook 配置的）+ `refreshWebhookIntake()`
     （**await**：deploy 返回成功时监听已就绪）；`deploy`/`remove` 后都刷新；
   - `start()` 起监听、`dispose()` 关监听；新增只读 `webhookListeningPort` 便于观测/测试；
   - `AutomationsRuntimeOptions.webhookPort`（测试传 0 让系统分配）。
4. `deployment-builder.ts`（app 侧）：webhook 触发 → `schedule:null` + `webhook:{token,filter}`
   （token 非法 → `invalid-definition/automation_not_configured`）；cron 触发照旧。

**验证**：新 `webhook-intake.test.ts` **8/8** 端到端（真起 runtime + **真发 HTTP**）：
没有 webhook 部署不起监听 · 只有 cron 也不起 · 部署后监听就绪 + 事件命中 → **多出一条 `triggerKind='webhook'` 的 run** ·
过滤不匹配 → 204 且**不产生 run** · 坏 token → 403/401 且不产生 run · 非法过滤表达式 → **部署被拒** ·
移除 → 监听关掉（连不上） · 禁用 → 监听直接关（比 403 更彻底）。
`packages/core` automations **111 passed（14 文件）** · app 侧 automations **57 passed** ·
core / app-node typecheck **各 0 错误** · oxfmt 干净。

**⚠️ 已知待办**：① **UI**（表单选触发源 + 显示 token/URL —— 现在只能用 API/DB 配 webhook）；
② app 侧 `deployment-builder` 的 webhook 分支**还差一条单测**（core 侧已端到端覆盖）；
③ 事件载荷注进 prompt 的 `promptTemplate`（字段已备好，尚未接）。

### 19d. [XG-CUSTOM 2026-10-05] 事件触发 **UI**（第 3 项 · 最后一公里，至此可用）

**落了什么**（表单里能选、能填、能存、能校验）：
- `useAutomationFormState.ts`：新增 `triggerKind`（`cron`/`webhook`，从 seed 读回）+ `webhookToken` / `webhookFilter`；
  `triggerConfig` 按触发源产出**两种形状**；`canSave` 加 `validateTriggerConfig(...) === null`
  —— **webhook 缺 token 时不许保存**（否则等于开个裸接口）。
- `components/AutomationSettingsFields.tsx`：触发源区加了 **On schedule / On event** 切换；
  选 On event 时把 CronPicker 换成 **Callback token**（带 `Generate` 按钮，`crypto.randomUUID()`）+
  **Event filter (optional)** + **Callback URL**（`http://127.0.0.1:7823/automation/<automationId>`，
  并提示请求头 `x-emdash-automation-token`、保存后才有 automation id）。
- 新增 `primitives/automations/api/config.test.ts`（**6 项**）：旧数据（无 kind）仍解析且判定为 cron ·
  cron 缺表达式报错 · **webhook 缺 token/太短报错** · token 够长通过（filter 选填）。

**验证**：`tsgo --noEmit` browser / node **各 0 错误**；app 侧 automations + primitives **63 passed（14 文件）**；oxfmt 干净。

**踩坑**：`canSave` 与 `triggerConfig` 的顺序 —— 我把 `triggerConfig` 定义放在 `canSave` **之后**，
触发 TDZ 报错（`TS2448/TS2454: used before its declaration`），移到前面即好（**以后加常量记得放在使用点之前**）。

**至此第 3 项（事件/webhook 触发）四项齐活**：schema+过滤器 → 摄取端 → 运行时接线 → UI。
仍留两个小尾巴（都不阻塞使用）：`promptTemplate`（把事件载荷注进 prompt）未接；
app 侧 `deployment-builder` 的 webhook 分支还差一条单测（core 侧已端到端覆盖）。

### 19e. [XG-CUSTOM 2026-10-05] 本版 exe 的**构建点对应关系**（可追溯）

| 项 | 值 |
|---|---|
| 版本 | **`1.2.17-xiangwo`**（`ae945ee7c` bump；含今日全部改动） |
| 打包 run | **#37269583576**（`release-prod.yml`，`--ref main`） |
| **构建用的 commit** | **`ae945ee7c`**（= 版本 bump 那个提交） |
| 之后的两个提交 | `02d863c6f`（webhook-filter 的 **Expr 拆分**，纯类型）+ `f4503b5b2`（**补定制标记**，纯注释）——**都在构建点之后**，只影响源码可读性/类型，不影响运行时行为，故此包**无需重打** |
| 产物位置 | draft release `v1.2.17-xiangwo` 的 asset `emdash-x64.exe` → 拷到 `~/Desktop/emdash-x64-v1.2.17-xiangwo.exe` |

**打标审计（今天）**：emdash 侧改动 **31 个文件**，**30 个带 `[XG-CUSTOM]` 标记**；唯一没有的 `package.json`
是**惯例如此**（版本号 `-xiangwo` 后缀即标记，历次 bump 都不标注）。
审计中修掉一个真缺口：`AutomationSettingsFields.tsx` 漏标 → 补上时**第一版把 `//` 注释插进了 JSX 子节点**
（那里是**文本内容、会被渲染出来**）→ 已改为模块级注释（类型检查不会发现这个问题，属"看起来过了其实脏了"）。

### 19f. [XG-CUSTOM 2026-10-05] 事件触发收尾四项（promptTemplate / builder 单测 / 市场卡体检 / 归一表）

1. **`promptTemplate`（事件载荷进 prompt）** —— `scheduling/webhook-prompt.ts`（新）+ 接线：
   - 三态：**没配模板 = 原样**（零行为变化）· 有 `{{payload}}` = 替换成**缩进过的 JSON** · 无占位符 = **追加**（不丢事件信息）
   - 载荷**超长截断**（4000 字符，避免一次事件撑爆上下文）；非 JSON 不炸
   - 接线：`automationWebhookTriggerSchema.promptTemplate` → app `deployment-builder` → runtime `onEvent`
     用 `withWebhookPrompt()` 把渲染结果装进**新部署对象**（不改原对象；`configSnapshot` 里因此能看到渲染后的 prompt）
   - 验证：`webhook-prompt.test.ts` **8 项** + `webhook-intake.test.ts` 加 **2 条端到端**（快照里能看到渲染值 / 没配模板保持原文）
2. **app 侧 builder 的 webhook 分支单测** —— `deployment-builder.test.ts` 加 **2 条**：
   webhook → `schedule:null` + `webhook{token,filter,promptTemplate}`；**token 太短 → 拒绝部署**（`invalid-definition/automation_not_configured`）
3. **工具市场卡「体检 / 密钥开关」**（对 OpenHands `mcp-server-health` + `save-as-secret-toggle` 的等价物）：
   - **密钥键名默认隐藏**（截图/投屏不该顺手暴露"接了哪些密钥"），勾选「显示密钥键名」才展开
   - **「重新体检」按钮** → 发一条消息让 agent 走 `mcp_market(probe=true)`（**现场重新枚举**，慢 ~2s；缺省仍用目录缓存不阻塞）
   - 验证：`xiangwo-mcp.test.ts` **17 项**（+2 新）
4. **风格池归一表** —— `xiangwo-agent/xg_style_normalize.yaml`（新，17 条映射）+ `xg_style_vocab.py` 读它并注进提示块：
   `高饱和/撞色→波普` · `复古印刷→复古` · **`强排版/字体→波普`**（若要偏现代主义排版改一行到 极简留白）·
   `插画/图形→插画` · `侘寂风→日式侘寂` · `中式国风/国风→国潮` · `海报设计→海报` · `VI→VI系统` …
   - **硬约束（测试强制）**：每个映射目标**必须是 `sxsj-style-tags.yaml` 里真实存在的标签**（写错就静默失效）
   - 验证：`_test_xg_style_vocab.py` **4/4 组**；真实提示块 621 字符，含 17 条对照
   - **踩坑**：首版解析器用 `\S+\s*$` 要求"值后就是行尾" → **带行尾注释的映射被静默丢掉**（`高饱和/撞色`、`强排版/字体` 两条），
     且续行注释被误当映射 → 改为**先剥行尾注释**再解析（测试抓到的）

### 20. [XG-CUSTOM 2026-10-05] 「球指挥主界面」动作面（第一刀：白名单 + 受控 IPC）

**用户要求**：「**球要用到的网页，跟别的功能主界面要同步支持**」。

**现状清点**（2026-10-05）：主界面有 **22 个功能区 / 350 个命令**（typed `CommandCatalog`
+ palette 组装器 + 渲染侧 `keybindingDispatcher`），而球只够得着 **5 个 method**
（`host.openEmbeddedBrowser`/`host.openExternal`/`backend.*`/`debug.trace`）。
⇒ **正确做法不是给每个功能单开一条 IPC**（必然两边漂移），而是**以主界面命令目录为事实源**，
只暴露"允许外部触发"的子集。

**本次落地**：
1. `main/host/xiangwo-host-commands.ts`（新）—— **白名单（唯一事实源）**：8 条命令
   （`app.commandPalette`·`app.settings`·`app.navigateBack/Forward`·`view.task`·`app.toggleTheme` 为 read；
   `app.newTask`·`app.newProject` 为 **write**）+ `listHostCommands/findHostCommand/isHostCommand/requiresApproval`。
   🔴 三条硬约束写进文件头：① **表外一律拒**（默认不可触发）② **写类必须用户批准**
   （`requiresApproval` 对**表外 id 也返回 true** → 默认从严）③ **只放命令 id**，绝不暴露任意 IPC 频道。
2. `main/host/xiangwo-orb-api.ts`（改）—— 新增 `configureOrbHostCommands(run)` 注入点
   （照已有 `configureOrbEmbeddedBrowserOpen` 同一模式：命令在**渲染进程**执行，主进程发不到，故由 boot 注入）
   + 两个 method：`host.listCommands`（回白名单）· `host.runCommand`（**查表 → 写类拦下 → 转发 → 结构化回执**
   `{ok}|{ok:false,reason:unknown-command|needs-approval|unavailable|failed}`）。
3. `main/host/xiangwo-host-commands.test.ts`（新，**6 项**）：结构不变量（id 唯一/形如 `x.y`/标题非空）·
   ★表外不可执行 · ★写类必须审批 · ★**表外 id 的审批判定也从严** · 返回副本不可篡改白名单 · 首批集合快照。

**验证**：`tsgo --noEmit -p tsconfig.node.json` **0 错误**；`vitest` **36 passed**（白名单 6 + 球原有 30 零回归）。

**⚠️ 还没做的三件（下一步）**：
① **boot 注入**：主窗口需把 `configureOrbHostCommands(...)` 接上真实执行器（渲染侧 `keybindingDispatcher`
   的命令执行路径）—— 这是它真正"能动主界面"的最后一环；
② **球渲染侧**：解析动作块（如 `[XG-ACTION]{...}[/XG-ACTION]`）→ 调 `bridge.orbApi('host.runCommand', …)`
   （**preload 无需改**：球已有通用 `orbApi(method,args)` 通道）；
③ **agent 侧**：加工具（如 `emdash_action`）+ 工具描述里治**撞名**（"要在用户 emdash 里做 X → 用它，
   别用 `wego.browser_goto`"）—— 即 `mu-OPS.md §15.6` 记的那个缺口。

### 21. [XG-CUSTOM 2026-10-05] 修「agent 开的页只在后台跑、用户看不到」（presentToUser 分叉）

**用户报的真问题**：agent 经 emdash 通道开页**成功**（9223 通道 8.8s 加载成功），
但**只在后台运行** —— 用户在 emdash 里看不到那个网页界面。

**根因（读代码定位）**：`embedded-browser-open-request.ts::resolveTargetTask(botId)` 带 `botId` 时
**优先开进 bot 自己的 project 的 task**（注释原话：「页开进 bot 自己的 project 的 task，
而不是用户当前视野里的那个 task」）。这是**有意的隔离**（agent 自查资料不搅乱用户视图），
但"**用户要看**"也走同一条路 ⇒ 页开在视野之外。

**修法（把两种意图分开）**：
1. 决策逻辑抽成**纯函数** `pickTargetTask({presentToUser, current, botEntry, first})`（**可离线测**）：
   - `presentToUser=true`（用户要求看 / 球上点卡片）→ **开在用户当前 task**；没 task 才退到第一个（且必须导航）
   - `presentToUser=false`（agent 自用）→ **维持原行为**（bot task 优先 → 当前 → 第一个），零回归
2. `resolveTargetTask(botId, presentToUser)` 改成**薄适配**（只收集输入）
3. `openEmbeddedBrowserTab(url, profileId?, botId?, presentToUser)` 加参数并透传
4. 订阅处从事件读 `presentToUser`（`'presentToUser' in event` 收窄，**不用 any**；字段缺省 = false = 旧行为）

**验证**：新 `embedded-browser-open-request.test.ts` **6 项**
（presentToUser 优先用户 task / 没 task 退第一个且导航 / 都没有 → undefined / agent 自用仍是 bot task / 已在 bot task 不导航 / 无 botEntry 用当前）；
`tsgo` browser + node **各 0 错误**。

**⚠️ 还差一步才算端到端**：**主进程生产方**（`requestEmbeddedBrowserOpen` 事件 / agent relay / `[XG-PREVIEW]`）
与 **agent 工具**目前**都不带 `presentToUser`** ⇒ 现在实际仍按旧行为（false）。
要真正修好用户看到的那个现象，需：① 事件 schema 加 `presentToUser` ② agent 侧在"用户要看"时置 true
（可与 `mu-OPS.md §15.6` 的 `emdash_open` 工具一起做）。渲染侧已就绪，字段一到即生效。

### 22. [XG-CUSTOM 2026-10-05] 球侧动作块 `[XG-ACTION]`（球指挥主界面·客户端的客户端）

**属于**：A 方案三件套里的第 2 件（球渲染侧）。**第 1 件（boot 注入执行器）与第 3 件（agent 工具）仍未做**。

**新增** `renderer/orb/xiangwo-action.ts` + `xiangwo-action.test.ts`（**8 项**）：
- `parseXiangwoActionBlock(text)`：解析 ```` ```xiangwo-action ```` 块（单个/数组多动作）；
  **坏 JSON / 缺 id → 跳过不抛**（宁可少做一个动作，也不因一段坏块打断整条回复）
- `stripXiangwoActionBlocks(text)`：把动作块从正文里去掉（别把 JSON 显示给用户）
- `runXiangwoAction(action, run)`：交给注入的 `run`（球里 = `orbApi('host.runCommand', …)`）；
  **不抛** —— 异常收敛成 `{ok:false, reason:'failed'}`；主进程回的 `reason` **原样带出来**
- `actionFailureText(action, result)`：四种原因（`needs-approval`/`unknown-command`/`unavailable`/其它）
  → 各一句**不粉饰**的人话（"写操作需要你确认" / "不在可执行清单里，我没做" / "通道还没接上" …）

**三条约定（写进文件头）**：① 声明式（只传 id + 参数，**不传代码**）② **白名单只在服务端**判
（球侧只校验格式，避免两边漂移）③ 回执如实（不假装成功）。

**验证**：`vitest` **8 项通过** · `tsgo -p tsconfig.browser.json` **0 错误**。

**⚠️ 还没接进 `orb.js` 的解析链**（与 images/mcp/question 三块并列）—— 下一步做，
连同第 1 件（boot 注入）与第 3 件（agent 工具 + `presentToUser`），做完再 bump `1.2.19` 打一次 exe。

### 23. [XG-CUSTOM 2026-10-05] 动作块接进球渲染链（A 方案第 2 件收尾）

`renderer/orb/orb.js`：解析链从 `images → mcp → question` 扩为 **`images → mcp → action → question`**：
先 `parseXiangwoActionBlock` 取出动作，再 `stripXiangwoActionBlocks` 把块从正文去掉（别把 JSON 显示给用户），
最后交给提问卡解析；渲染完成后**逐个执行**（`runXiangwoAction` → `bridge.orbApi('host.runCommand', …)`）——
**成功不吵，失败在气泡下补一句如实的话**（`actionFailureText`，如"「app.newTask」属于写操作，需要你确认后我才能执行"）。
`orbApi` 不可用 → 回 `{ok:false, reason:'unavailable'}`（不假装成功）。

**验证**：`oxfmt orb.js` 语法自检通过；`xiangwo-action.test.ts` + `xiangwo-mcp.test.ts` 通过；browser typecheck 0 错误。

**A 方案剩余**：第 1 件（boot 注入执行器 —— 主窗口把 `configureOrbHostCommands(run)` 接上命令执行路径）
· 第 3 件（agent 工具 `emdash_action` + "用户要看"时带 `presentToUser` + 治 wego 撞名）。

### 24. [XG-CUSTOM 2026-10-06] 内嵌浏览器「开错机器/开不出来」三修 + 球指挥开网页（TASK 1 / 3 / 4）

承接《emdash 内嵌浏览器开错机器-修复OPS-2026-10-06》四个坑里的三个（TASK 2 在 agent 侧，不涉及 emdash）。

**TASK 1（P0 治本）· 缺省代理 Tailscale → ZeroTier**
`main/host/browser/xiangwo-browser-proxy.ts`：`XIANGWO_BROWSER_PROXY_DEFAULT`
`100.125.4.119`（Tailscale）→ **`10.239.5.174`（ZeroTier）**。真机口径（Windows → Linux 各 12 次）：
ZeroTier **12/12、平均 6ms**，Tailscale **0/12 全超时**（`tailscale status` 走美国 Denver 中继）
⇒ 改前 Windows 内嵌浏览器一开就 `ERR_SOCKS_CONNECTION_FAILED`。
**同时删掉文件头那句「10.239.5.174 是旧的 ZeroTier 地址，已失效」**（实测正好相反，留着会被下一个人改回去），
`browser-profile-session.ts` 的同款注释一并更正；单测把缺省值**写死断言**（谁改回去这条就红）。
影响面只有**非 Linux 平台**的缺省；`xiangwo-browser-proxy.json` / `XIANGWO_BROWSER_PROXY` 优先级不变。

**TASK 3（P1）· 内嵌页绑定不再只等 `dom-ready`**
根因（真 Electron 40.10.2 + Xvfb 探针实测）两条：
① **慢加载**（TCP 连上却永不回响应）20s 内**只有 `did-start-loading`/`did-attach`、没有 `dom-ready`**，
且这两个时机 `getWebContentsId()` **会抛**（`createGuest()` 回包与事件转发的竞态）
⇒ 旧实现只在 `dom-ready` 里 `bindWebContents` ⇒ **永不进白名单** ⇒ 桥误报「30s 内没有页面被绑定」；
② 死域名那例 `dom-ready` **其实会来**（错误页也是真 document），真因是主框架 `loadError` 一到就把
`<webview>` **换成错误视图** ⇒ React 卸载 ⇒ guest 销毁 ⇒ 白名单丢页。
改法：新增 `core/features/browser/browser/browser-webview-bind.ts`（**幂等 + 250ms×至多 10s 退避重试 + 只 warn 不抛**），
`browser-pane.tsx` 的 `onEarlyBind`/`onDomReady` 都走它；`browser-webview-events.ts` 在
`did-start-loading`/`did-attach`/`did-fail-load`/`did-finish-load`/`did-stop-loading` 各给一次机会；
`browser-webcontents-registry.ts` 加**只读** `countPendingWebviews()`；
`xiangwo-cdp-bridge.ts` 超时结果**按证据分档** + `reason` 码
（`attached-not-bound`／`profile-mismatch`／`no-webview-attached`／`unknown`，老调用方不接计数则文案逐字节不变），
顺手把注释里过期的「缺省 12s」与 `XIANGWO_CDP_OPEN_BROWSER_WAIT_MS = 30_000` 对齐。
⚠️ **安全闸门一个没放开**（partition 校验 / 主进程自建 WebContentsView / 白名单范围都没动）。

**TASK 4a（P2）· 球动作块直连 `host.openEmbeddedBrowser`**
`renderer/orb/xiangwo-action.ts` 加**直连方法表**（`XIANGWO_DIRECT_ACTIONS`，**只登记这一个 id**）：
命中就 `run('host.openEmbeddedBrowser', {url[,bot]})`，**不走** `host.runCommand` —— 因为白名单 8 条 UI 命令
**没有一条能开网页**，而这条 orbApi 方法本来就接好了（球里点图片卡片走的就是它）。
url 用白名单式判断只认 `http(s)`，非法**一次调用都不发**；**白名单与 boot 注入都没动**。

**TASK 4b 的 emdash 半边 · `presentToUser` 透传链接通**
`core/primitives/browser/api/browser.ts`（事件类型 + `presentToUser?`）→ `wiring.ts`（**只有显式 true 才下发**）
→ `xiangwo-cdp-bridge.ts`（POST 体只认**布尔 true**，透传给广播）→ `background.ts`（**球侧来的请求 = 用户要看的页**，
恒带 true）。消费者（`embedded-browser-open-request.ts` 的 `pickTargetTask` 分叉）是 10-05 写的，
**此前没有任何调用方下发过这一维 ⇒ 一直是死码**，本轮接通（页开进**用户当前 task**，而不是 bot 自己的 task）。
⚠️ 已知限制：**复用已绑定页**时它仍留在原来那个 task；反向通道（`xiangwo-browser-relay.ts` 的 `open`）没接这一维。

**验证**：`vitest --project node`（`main/host/browser` + `core/features/browser` + `renderer/orb`）
**27 文件 / 339 项全绿**；`tsgo --noEmit -p tsconfig.browser.json` **rc=0**、
`tsgo --noEmit -p tsconfig.node.json` **rc=0**；台账 `check.mjs` 刷新为 **144 文件 / 813 处**、**0 处丢失零漂移**；
`xiangwo-browser-proxy.test.ts` 7 项（含缺省值写死）；本机实测代理经 `10.239.5.174:1080` **HTTP=200**。

**未覆盖 / 留给下一单**：① 失败页（主框架 loadError）仍会从 `/json/list` 消失 —— 要"加载失败也留在白名单"
得把错误视图改成**覆盖层**或给 webview 加 `hidden`（**改用户可见 UI**，本轮没做）；
② `xiangwo-browser-relay.ts` 那处过期「缺省 12s」注释与超时文案未接分档；
③ Windows 真机 A/B（`/json/list` 多出该页、日志 `[web_render] 内嵌浏览器目标 = http://127.0.0.1:9224`）
要等用户那台在线并装上本版 exe。

---

### 25. [XG-CUSTOM 2026-10-06] OpenDesign 集成卡片（设计工作台 7456）

**要解决什么**：把 open-design 集进 emdash。用户原话「**你不会看下 weknora 怎么集的**」
⇒ **照 WeKnora / Kaneo / AFFiNE 模板**，不发明新机制。
（HippoBuddy 当年只有一个 `data-panel="opendesign"` 的**浅入口**（打开本地目录 + 打开官网），
而 HippoBuddy 已退役 ⇒ 那个面板的新家就是这里。）

**open-design 是谁**：上游 `nexu-io/open-design`（**Apache-2.0**，最新 tag **`open-design-v0.24.1`**，
star 9.9 万）；本地副本 = **`工具链/open-design`**（v0.24.1 / commit `89e64d8`）。
daemon 默认端口 **7456**（`apps/daemon/src/server.ts`）。它本身是**开源 + 云模型订阅**双轨，本地 BYOK 免费。

**照 Kaneo/AFFiNE 模板改 5 处**：
| # | 文件 | 加什么 |
|---|---|---|
| 1 | `main/host/window.ts` | `createOpenDesignWindow(url='http://127.0.0.1:7456')`（单例窗口 1400×900，照 `createWeKnoraWindow`） |
| 2 | `main/bootstrap/boot/wiring.ts` | import `createOpenDesignWindow` + handler `openOpenDesign`（走 `services.resolveToolWindowUrl(7456)`） |
| 3 | `core/primitives/desktop-host/api/host-contract.ts` | `openOpenDesign` procedure |
| 4 | `core/primitives/desktop-host/browser/host-client.ts` | `openOpenDesign()` |
| 5 | `core/features/settings/browser/components/IntegrationsCard.tsx` | import + 🎨「OpenDesign」卡片（「本地工具」组末尾） |

⚠️ **地址必须走 `resolveToolWindowUrl(7456)`，不写死 `127.0.0.1`** ——
否则 Windows 客户端白屏（就是定制 **#15** 那个坑，别再犯）。

**升级找回**：`grep -rn "openOpenDesign\|createOpenDesignWindow" apps/emdash-desktop/src`

**验证**：`pnpm run typecheck`（`tsgo --noEmit` × browser/node/release 三个 tsconfig）→ **exit 0**；
台账 `check.mjs` → **漏标 0**（本轮新增行全部带 `[XG-CUSTOM]`）。
⚠️ **未验**：真实点开卡片（要重新打包 + 用户点桌面图标，见「一、AI 不要自己启动 emdash」）。

### 28. [XG-CUSTOM 2026-10-09] WorkRally 本地出图**参数面板**卡片（8189/panel）

> ⚠️ 编号说明：本文件历史上**已有重复编号**（24/25/26/27 各出现 2–3 次）⇒ 本条取当前最大号 **28**，不回填空隙。**找回一律靠 `grep [XG-CUSTOM]` 与下面那行 grep，不靠编号。**

**要解决什么**：用户要「把要调的参数变成**卡片**，在 OpenDesign 或 emdash 的聊天窗口上显示」。
OpenDesign 聊天窗那半已经用它自带的 `<question-form>` 做了（**每回合一次**的卡片）；
**这一半是「甲」**：一块**常驻、参数留着**的面板，供**反复调参**（换 seed 做 A/B、加减步数）。
⇒ 服务端不是新东西：面板 HTML 由**我们自己的**本地 Server 直接吐
（`scripts/workrally_panel.html` + `scripts/workrally_local_server.py` 的 `GET /panel`），
**全本地**（→ 本机壳 8199 → Win ComfyUI），面板本身不发外网请求、无外部 CDN。

**照 Kaneo/AFFiNE/OpenDesign 模板改 5 处**（与定制 #25 逐处对齐）：
| # | 文件 | 加什么 |
|---|---|---|
| 1 | `main/host/window.ts` | `createWorkRallyPanelWindow(url='http://127.0.0.1:8189/panel')`（单例窗口 1200×900，照 `createOpenDesignWindow`） |
| 2 | `main/bootstrap/boot/wiring.ts` | import `createWorkRallyPanelWindow` + handler `openWorkRallyPanel`（走 `services.resolveToolWindowUrl(8189, '/panel')`） |
| 3 | `core/primitives/desktop-host/api/host-contract.ts` | `openWorkRallyPanel` procedure |
| 4 | `core/primitives/desktop-host/browser/host-client.ts` | `openWorkRallyPanel()` |
| 5 | `core/features/settings/browser/components/IntegrationsCard.tsx` | import + 🖼️「WorkRally 出图参数面板」卡片（「本地工具」组末尾） |

⚠️ **地址必须走 `resolveToolWindowUrl(8189, '/panel')`，不写死 `127.0.0.1`** ——
否则 Windows 客户端白屏（定制 **#15** 那个坑，别再犯）。
⚠️ 面板依赖的本地 Server 是 **user unit `workrally-local.service`**（`:8189`，只绑回环）——
它没起时窗口会白屏/连接失败；先 `systemctl --user start workrally-local.service`。

**升级找回**：`grep -rn "openWorkRallyPanel\|createWorkRallyPanelWindow" apps/emdash-desktop/src`

**验证**：`pnpm run typecheck`（`tsgo --noEmit` × browser/node/release）→ **exit 0**。
⚠️ **未验**：真实点开卡片（要重新打包 + 用户点桌面图标，见「一、AI 不要自己启动 emdash」）；
面板本体已另用 Playwright 端到端验过（参数可调 + **重载后参数还在** + 一键出图 **108s / 768×1152 = 面板里选的 2:3**）。

### 24. [XG-CUSTOM 2026-10-05] 方案 A：`xiangwo-open-url` 块 —— **让 emdash 主界面开网页**（不用白名单/不用 boot）

**为什么走这条路**（同日 `emdash内嵌浏览器开错机器-修复OPS-2026-10-06` §TASK 4 的「方案 A（最省）」）：
`host.openEmbeddedBrowser` 是**球已有的独立 orbApi 方法，且 boot 已注入**（`background.ts`
的 `configureOrbEmbeddedBrowserOpen` → `requestEmbeddedBrowserOpen` → 主窗口 `openEmbeddedBrowserTab`；
球里点图片卡片走的就是它）。⇒ **不需要** `configureOrbHostCommands` 注入、**不需要**动
CommandCatalog 白名单 —— **只要球渲染侧认这个块，做完立刻可用**。

**本次落地**：
- `renderer/orb/xiangwo-action.ts` 追加：`parseXiangwoOpenUrlBlock`（**只收 http(s)**、数组/对象都认、
  去重、坏 JSON 跳过不抛）· `stripXiangwoOpenUrlBlocks` · `openXiangwoUrls(urls, run)`
  （逐个调 `host.openEmbeddedBrowser`；**失败如实回报** `{ok:false, reason}`，不假装开好了）
- `renderer/orb/orb.js`：解析链扩为 **`images → mcp → action → open-url → question`**；
  渲染后逐个开页，失败在气泡下补一句如实的话（`unavailable` → "这条开页通道没接上…"）
- 测试：`xiangwo-action.test.ts` 新增 7 项（全 **22 项**通过）；orb 全量 **106 项**通过；browser typecheck 0 错误

**方案 B（正统，攒到下次打包）**：boot 注入 `configureOrbHostCommands`（接 `keybindingDispatcher`；
注意 `openAffine/openWeKnora` 是 `hostOperations`、**不是** CommandCatalog 命令，需桥接）
+ 白名单加一条能开浏览器的命令 + agent 输出 `xiangwo-action` 块。

### 25. [XG-CUSTOM 2026-10-05] 方案 B 实施计划（已探明落点，待实施）

**为什么当时没做**（诚实记录）：① 同日 `emdash内嵌浏览器开错机器-修复OPS-2026-10-06` 明确写
「两条都要改 emdash + 走 CI 打包 ⇒ 不宜为它单独发版，攒着跟下一个改动一起打」② B 动的是
**主界面命令执行路径**（比 A 危险）③ 当时空间见底。**但 B 才是"球指挥主界面其他功能"的正解。**

**★ 已探明的落点（省掉下次再摸）**：

| 事实 | 出处 |
|---|---|
| `CommandDef` **只是元数据**（id/title/category/`input` zod/keybinding），**没有执行函数** | `core/primitives/commands/api/define-command.ts:6-18` |
| **执行在 view scope**：`execute(input, source?: CommandSource)`；默认 `source='programmatic'` | `core/primitives/view-scopes/api/define-view-scope.ts:57,64` · `.../browser/scopes.ts:68-70` |
| 快捷键路径也是走它：`hit.command.execute(undefined, 'keybinding')` | `renderer/lib/keybindings/keybinding-dispatcher.ts:99` |
| ⇒ **"按 id 执行一条命令"的现成入口 = 当前 view scope 的 `execute(id, input, 'programmatic')`** | 同上（`programmatic` 这个 source 本来就是给程序化调用留的） |
| 球侧通道/白名单**已就绪**（本轮已做） | `main/host/xiangwo-orb-api.ts` `host.listCommands`/`host.runCommand` · `main/host/xiangwo-host-commands.ts` |

**实施四步**：
1. **主窗口渲染侧**加一个受控执行器：`runHostCommand(id, args)` →
   `viewScope.execute(id, parsed, 'programmatic')`（**参数校验用命令自带的 `input` zod schema** —— 天然有校验）。
2. **主进程 → 主窗口**：新事件（如 `xiangwo:host-command`）+ 回执回传；`mainWindow.webContents.send(...)`。
3. **boot 注入**：`main/bootstrap/boot/phases/background.ts` 里调
   `configureOrbHostCommands((id, args) => sendToMainWindow(id, args))`（**当前从未被调用** → 所以 `host.runCommand` 永远回 `unavailable`）。
4. **白名单**：8 条已就绪；"开网页"**不必**加成命令（它有自己的通道，见条目 24 方案 A）。
   若要统一，可把 `openEmbeddedBrowserTab` 作为一个 host operation 桥进来。

**收尾**：测试（表外拒/写类需审批/参数不合 schema 拒/正常执行）+ bump 一版一起打包。

### 25. [XG-CUSTOM 2026-10-06] 内嵌浏览器代理**三种语义显式化** —— 顺带查明"上游有没有这个能力"

用户问「搜国外网的上网能力是不是要加回 emdash 原代码能力（他是国外的作品）」。查证（可复核）：

```bash
git show origin/main:apps/emdash-desktop/src/main/host/browser/browser-profile-session.ts | grep -n proxy
#  → 空。**上游浏览器侧根本没有代理代码**（它的内嵌浏览器 = Electron 缺省 = 跟随系统代理）。
grep -n "HTTP_PROXY\|HTTPS_PROXY\|ALL_PROXY\|NO_PROXY" packages/core/src/primitives/agent-env/api/index.ts
#  → 67/68/76 行：上游唯一的"代理原能力" = 把代理**环境变量透传**给它拉起的 agent CLI（这段我们没动、还在）。
```

⇒ 结论：**不是"加回"，而是"我们多加的那层要收敛"**。我们 fork 在非 Linux（Windows/macOS）上
**缺省强制** `socks5://10.239.5.174:1080`（Linux 那台的代理）⇒ **会把用户 Windows 上本来能上外网的
系统代理/梯子架空** —— 这很可能就是"agent 搜国外网搜不动"的一个主因。

**改动**（`main/host/browser/xiangwo-browser-proxy.ts` + `browser-profile-session.ts`）
- `XiangwoBrowserProxySettings` 增加**必填**的 `mode: 'proxy' | 'direct' | 'system'`，调用方必须显式处理三种语义；
- `off/none/direct/no/0/false` ⇒ **`setProxy({mode:'direct'})`**（真直连）。
  ⚠️ 旧代码这里是"**不调** setProxy" ⇒ 那其实是 **跟随系统** —— 说一套做一套，本轮修掉；
- **新增** `system/auto/default/os/sys` ⇒ **`setProxy({mode:'system'})`**（= 上游行为）；
- `socks5://…`/`http://…` ⇒ `setProxy({proxyRules})`（不变）；
- **[B 方案，用户 10-06 拍板] 什么都不配且非 Linux ⇒ 系统优先**：先 `ses.resolveProxy('https://github.com/')`
  探一句（`systemProxyIsConfigured()`），**系统有代理 → `mode:'system'`（跟随系统 = 上游行为，用户的梯子立刻生效）**；
  系统没有 → 才用我们那条 socks5 缺省。显式配的（env / 配置文件）**永远赢**（`applySystemFirstDefault()` 纯函数，可离线测）。

**验证**：`vitest --project node xiangwo-browser-proxy.test.ts` → **12 passed**
（含新增 5 条：`system` / `auto|default|os|SYS` / 配置文件 `system` / `off`=direct / 缺省零回归）；
`tsgo --noEmit -p tsconfig.node.json` → **rc=0**；`oxfmt --check` 三文件 → 全绿。

### 26. [XG-CUSTOM 2026-10-06] 命令面板加「打开网址…」（`browser.openUrl`）—— 把 Forward Port 的误会消掉

**用户真机反馈**：想在 emdash 里"打开一个网址"，点工具栏那颗按钮弹出来的是 **Forward Port**
（`preview-servers/manual-forward-dialog.tsx`：把**远端端口**隧道到本机预览 dev server，`5173` 只是占位）
—— 跟"打开网址"不是一回事。

**改法（13 个文件，全带裸 `[XG-CUSTOM] 2026-10-06`）**
| 新增 | 说明 |
|---|---|
| `core/features/browser/contributions/commands.ts` | `defineCommand({ id:'browser.openUrl', title:'打开网址…', category:'Browser', icon:'globe', input: z.object({url:z.string()}).optional() })` + `BROWSER_COMMAND_DEFS`（`.optional()` 是硬要求：palette 项只能以 `undefined` 调用） |
| `.../browser/contributions/palette.ts` | `defineCommandPaletteItem` + 中英 aliases（`open url`/`url`/`打开网址`/`网址`/`浏览器`）← **Ctrl+K 能搜到**就靠它 |
| `.../browser/browser/open-url-command.ts` | 纯函数：`resolveOpenUrlInput`（**只收 http(s)**；无协议补 `https://`；`javascript:`/`file:`/`data:`/`mailto:` **一律拒**；`localhost:5173` 按 host:port 处理，不当协议）+ `planOpenUrlCommand`（prompt/open/error）+ `openUrlInBrowserPane`（**只**调 `paneLayout.open('browser',{initialUrl})` + `setFocusedRegion('main')`，target 可注入） |
| `.../browser/browser/open-url-modal.tsx` | URL 输入框：复用**既有** `Dialog`/`Field`/`Input`/`Button`/`ConfirmButton`/`defineModal`（零新依赖、零自造 UI） |
| `.../browser/browser/open-url-command.test.ts` | 10 条单测（含"run 确实调了 `paneLayout.open('browser',…)`"、拒各种危险 scheme） |
| `.../browser/contributions/browser.ts` | `browserBrowserContributions = { views: [], modalDefs: [openUrlModal] }`（AGENTS.md 约定：modal 由所属 slice 暴露） |

改动 7 个：`command-catalog.ts` / `command-palette-catalog.ts` / `browser-contributions.ts`（三处聚合）、
`tasks/contributions/scopes.ts`（命令挂在 **taskViewScope**：执行体要"当前 task"）、
`tasks/browser/task-scope.tsx`（`'browser.openUrl'` 实现：无 url → 弹框；有 url → 纯函数校验；空/非法/拿不到 task view 都 **toast 如实提示**，不回退系统浏览器）、
`renderer/tests/browser/modal-catalog.test.ts`（expectedModalIds + `openUrlModal`）、
`preview-servers/manual-forward-button.tsx`（**功能不变**，只加 tooltip 中文「转发远端端口（预览 dev server），不是打开网址」）。

**用户怎么用**：进任意 task → **Ctrl+K** → 输入「打开网址」/`url` → 选「打开网址…」→ 粘贴（`https://g-mark.org` 或直接 `g-mark.org`）→ 回车 → 页开在**当前 task 的浏览器面板**里。

**验证**：`vitest --project node`（browser + manifests/shared 片）→ **17 files / 104 tests passed**（含新 10 条）；
`tsgo -p tsconfig.browser.json` / `-p tsconfig.node.json` → **rc=0**；`oxfmt --check` 13 文件 → 全绿；
台账 `--gen` 后 158 文件、`--check` **rc=0（0 丢失 / 0 漏标）**。提交 `22e12772d` + `211ca6ba5`。

**未覆盖**：① 只在 **task view** 里能搜到（Home/全局视图不显示 —— "开在当前 task"的必然结果）；② **原生菜单里没有它**
（菜单是 `main/host/menu.ts` 硬编码模板，要进菜单得改 main，本轮没碰）；③ `openUrlModal` 的**渲染**没做自动化验证
（本机 `--project browser` 起不来：Playwright chromium 未安装；CI 也跳过 browser 项目），逻辑由 node 单测覆盖。

### 26. [XG-CUSTOM 2026-10-06] 开页**默认落在"你正在聊的那个 task"** + 开完**切到前台**

**用户原话**：「我跟哪个 bot 聊天，他打开的**不是自己 bot 仓下聊天下面的网页**吗」
—— 即：页该开在**用户当前正在看的那个 task**（他聊天的那个 bot 的会话下面），而且**要看得见**。

**改了两处**（`core/features/workbench/api/browser/embedded-browser-open-request.ts`）：
1. **`openEmbeddedBrowserTab(url, profileId?, botId?, presentToUser = true)`** ——
   `presentToUser` **默认翻成 true**（用户视角优先）。要回到"agent 自用、开在 bot 自己 task"的隔离行为 →
   **显式传 false**。依据：`pickTargetTask({presentToUser:true})` → 用户当前 task（没 task 才退第一个并导航）。
2. **开完把那个 browser 标签切到前台**：`paneLayout.open('browser', …)` 只是**开/复用**面板，
   若它不是当前激活标签，用户就"看不到"（页在渲染、CDP 也连得上，但不在眼前 —— 这正是
   "只在后台运行"的第二半）。用现成的 `taskView.activateLastTabOfKind('browser')`
   （已在 `task-composition.ts:485` 的 kind 联合里：`'conversation' | 'file' | 'diff' | 'browser' | 'terminal'`），
   `try` 包裹（激活失败不拖垮开页），随后仍 `setFocusedRegion('main')`。

**验证**：`tsgo -p tsconfig.browser.json` **0 错误**；`workbench/api/browser` 全量 **77 项通过**（10 文件）。
**⚠️ 需打包才到你 Windows 客户端**（渲染侧改动）。

### 27. [XG-CUSTOM 2026-10-06] 修「原始标记裸露」：球兼容旧推图标记 `[XG-IMG]…[/XG-IMG]`

**用户报的现象**：对话里直接显示 `[XG-IMG]/persistent/home/…/sketch-…html.png[/XG-IMG]` 这样的**原始标记**。

**根因**：协议**两代并存** —— 现行是围栏块 ```` ```xiangwo-images ````（`XIANGWO_IMAGES_BLOCK_RE`），
而 agent 的**旧推图路径**发的是 `[XG-IMG]<地址>[/XG-IMG]`。球**只认围栏块** ⇒ 旧标记认不出、
**以纯文本裸露**在气泡里。

**修法**（`renderer/orb/xiangwo-images.ts`）：新增 `XIANGWO_IMAGES_LEGACY_RE`，在
`parseXiangwoImagesBlock` 里：
- 先按现行围栏块解析（**保持既有契约**：坏 JSON / 全非法项 → 块留在正文，"不吞消息"）
- 再收 `[XG-IMG]` 旧标记（**一条地址一张图**，走同一个 `normalizeXiangwoImages`），
  且**无论能否归一，一律从正文剥掉** —— 那是机器标记，**用户不该看到**
- 空标记 `[XG-IMG][/XG-IMG]` 也剥（不留残渣）

**测试**：新增 `xiangwo-images-legacy.test.ts` **5 项**（旧标记成图且剥净 / 多条 / 空标记 / 与围栏块混用 /
无块零副作用）；`renderer/orb` 全量 **124 项通过（6 文件）**。

**⚠️ 另记（不是我的改动，但当前 typecheck 红）**：`core/features/browser/browser/open-url-command.ts:121`
与它的测试引用 `BrowserTabOpenTarget.setFocusedRegion` —— **该属性不存在**（`TS2339`/`TS2353`）。
那是并发会话正在做的 `browser.openUrl` 命令 WIP，**未动**。

### 29. [XG-CUSTOM 2026-10-09] 中央技能库（skills-central）正确接入 + 只读语义 + 逐项容错

**背景**：09-21 接了「多来源技能发现」，但**一直没真正生效**，而且**带了个会删库的坑**（详见 `emdash-运行经验-OPS.md` §二十五·补）。

**症状（实测）**：`~/.config/emdash/logs/emdash.log` 最后写入 2026-10-08 13:27，结尾是
`EACCES ... skills-central/lean-ctx/SKILL.md` → `getInstalledSkills` → `AgentSkillsManager.refresh` →
`worker process exited` **gen 4/5/6（6 秒连崩 3 代）** ⇒ agent-config worker 再没起来，**技能列表整体不发布**。

**改了 7 个文件**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/runtimes/agent-config/node/runtime/skills.ts` | ① `collectFromRoot` **逐项 try/catch**（一个坏文件不再打死整次发现）② 外部来源标 `source:'central' + readOnly` ③ 可选 `skills-config.json`（`paths`/`ignore`，`EMDASH_SKILLS_CONFIG` 可指到别处）④ `removeSkill` **拒绝卸载外部来源**（防透过软链 rm -rf 外部技能库）⑤ 计数探到 919（原注释写 851） |
| 2 | `packages/core/src/primitives/skills/api/types.ts` | `source` 加 `'central'`；新增 `readOnly?` |
| 3 | `packages/core/src/primitives/skills/api/schemas.ts` | 两个 zod 枚举加 `'central'`；`catalogSkillSchema` 加 `readOnly` |
| 4 | `packages/core/src/primitives/skills/api/merge-installed.ts` | 合并时带上 `readOnly` |
| 5 | `apps/.../skills/browser/components/SkillsList.tsx` | 分类分组**真正生效**：外部只读 / 已装 / 可安装三块各自按大类分组（原实现把分类用在 `recommendedSkills` 上，可所有来源都 `installed:true` ⇒ 941 项永远平铺） |
| 6 | `.../SkillCard.tsx` | `readOnly` 不渲染装/卸按钮 |
| 7 | `.../SkillDetailModal.tsx` | 只读不给 Uninstall（保留「打开」）；来源标签加「中央技能库」 |

**配套数据修**（不在 git 里，另行记录）：`skills-central/lean-ctx/SKILL.md` 原是 **root:root 0600**
（10-02 被 root 脚本写成）⇒ `chown xgqlover && chmod 664`；`~/.agentskills` 从 09-14 那根**指向中央库的软链**
换成**真空目录**（否则中央库冒充 Local 层，且卸载会 `rm -rf` 到中央库）。

**分类表（2026-10-09 二次修复：`621 项未分类` → `0 项`）**：原来 `_gen_skill_categories.py` 只用「关键词 + `**分类**` 字段」，
919 个技能里 **621 个落「未分类」**（多数是英文技能包，既没有分类字段、说明还是自动生成的 `xxx skill` / `| — 中央技能库技能`）。
改成本地模型打标 + 关键词兜底的两段式：
- `_classify_skills_llm.py` → 用本机 **8090（qwen3.8-27b）** 给每个技能按「名称 + 说明 + 原分类字段」打一个**闭集大类**，
  写进 `技能分类-LLM缓存.json`（919 条，917 模型打标 + 11 人工钉住，**0 未分类**）。
- `_gen_skill_categories.py` → 优先读该缓存，缺失才用关键词兜底；`CATEGORY_HINTS`（给模型看的类别定义）与 `PIN`（人工钉住）都在这里。
- 🔴 两个坑记在 `_classify_skills_llm.py` 文件头：① 必须 `chat_template_kwargs={"enable_thinking": False}`
  （带思考时 20 条要 2473 输出 token，40 条一批直接顶穿 `max_tokens` ⇒ JSON 截断 ⇒ **919 条全失败、白跑 19 分钟**；关掉后同样 20 条只要 132 token）；
  ② 大请求会把 8090 打挂（引擎卡住不退 → systemd SIGKILL → 显存没释放 → 重启 `CUDA_ERROR_OUT_OF_MEMORY`），
  所以现在**输出上限 4000、批 100、连续 3 批失败就停**。

**分类粒度细化（2026-10-09 四轮 · 用户要求"要分"）**：17 类 → **22 类**，拆出/新增 7 个：
`出图与图像 47` / `视频与动效 22` / `音频·音乐·语音 13`（原「多媒体生成 67」三拆）、
`文档处理与转换 27` / `写作与文案 35`（原「文档与写作 43」两拆）、
`幻灯片与演示 23`（从「设计与创意 103」拆出，降为「设计与视觉 57」）、
`工具与本地集成 30`（**全新**：CLI/系统客户端/MCP 桥接，原来散在网络/办公/前后端/元技能四个桶里）。
其余 15 类：产品与决策方法论 104 · 架构与版本 96 · 模型与推理服务 82 · 流程与自动化 80 · 前后端与代码 70 ·
Agent 与专家 38 · 金融与商业 37 · 测试与验证 35 · 办公与协作 29 · 调研与检索工具 29 · 记忆与知识库 28 ·
技能库与元技能 23 · 安全与合规 12 · 网络与连接 2 · 其他 0（919/919 全有类）。
`PIN` 人工钉住 11 条（眼检过），`_classify_skills_llm.py --force-other` 负责把「其他」强制归位。

**仍未做**：`disabled` —— emdash 没有「把技能注入 agent」的通路（全仓只有 `skills.ts` 认 `.agentskills`），
「禁用不进 prompt」**没有消费方**，硬做就是空转。

**说明文本修复（2026-10-09 三轮，同一个用户目视发现）**：技能卡片上的说明直接来自 frontmatter 的 `description`，
而中央库 **316/919 条是自动生成时留下的垃圾**（`4a-feedback skill`、`| — 中央技能库技能`、`> — 中央技能库技能`），
正文其实基本都有真素材（`## Overview`、`**简介**`、路由表）——只是没写进 frontmatter。
- `_fix_skill_descriptions.py`（新）：本机 8090 从「名称 + 正文前 1200 字」提炼**一行中文说明（30~50 字）**，
  **只替换 frontmatter 的 `description:` 一行**（实测 898→923 字节、差异仅 1 行），默认 dry-run，`--apply` 才写。
- 结果：**919/919 说明正常，垃圾 0**（`/tmp/xg-skill-description-manifest.json` 记了 316 条的 old→new）。
- **⚠️ 这一步不需要重新构建**：说明是运行时从 SKILL.md 读的，面板点一下刷新就变。
- 顺带把分类**重算了一遍**（上次有 316 条是拿垃圾说明猜的）：**128 条标签变好**，例如
  `Agent-Router 全链路运维与验证` 从「测试与验证」→「模型与推理服务」、`8-bit-orbit-video-template` 从「设计与创意」→「多媒体生成」、
  `NanoBananaMCP` 从「元技能」→「多媒体生成」。分类变化才需要重新构建。
- 整库 tar 备份：`~/_backup-skills-central-desc-20261009-165443.tar.gz`（280 MB，md5 `18a3429f3027242461f8458debc7a792`，
  包内 SKILL.md 可读回验证过）。


---

### 30. [XG-CUSTOM 2026-10-09] 主聊天窗渲染 agent 发的图 + 每张图的源链接（图片卡）

**背景**：用户问「这个 emdash 不会发图，图后有链接吗？怎么还没有球侧这点功能」。
**查实：这条链四层各缺一环**（不是配置问题）：

| 层 | 缺什么 | 证据 |
|---|---|---|
| agent 出图 | `xiangwo-images` 围栏块**只发给球**；非球端**主动降级**成 markdown 图（**顺带丢掉 `page` 源链接**） | `xiangwo-agent/agent.py:1188` |
| 协议判定 | ACP 主聊天窗落 `"none"` | `context-ir/…/card.py::protocol()` |
| ACP 桥 | **只认 `[XG-IMG]`**，不认围栏块 | 改前 `grep xiangwo-images xiangwo_acp.py` = 0 |
| emdash 渲染 | `agent_message_chunk` 非 text ⇒ **`ignored`**（base64 图被静默丢）；chat-ui 又把 `![]()` **降级成文字链接** | `reducer/decode.ts:123/133/143` · `chat-ui/…/markdown/parse.ts:179-180` |

**改了 10 个文件**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/src/primitives/acp-transcript/api/normalized-event.ts` | `message` 事件加 `images?: {mimeType,data}[]` |
| 2 | `packages/core/src/runtimes/acp/api/reducer/decode.ts` | `agent_message_chunk` 加 **image 分支**（**text 与 ignored 行为一行未动**） |
| 3 | `packages/core/src/runtimes/acp/api/models/turns/messages.ts` | `transcriptMessageSchema` 加 `images` **optional**（**不加就过 wire 被 zod strip**） |
| 4 | `packages/core/src/runtimes/acp/api/reducer/item-fold.ts` | 同 id 追加图片；**无正文图片事件挂到本回合最后一条 assistant 消息**；每条消息 60 张上限 |
| 5 | `packages/chat-ui/src/model.ts` | 新增 `ChatMessageImage`（与 user 的 `attachments` **语义分开**） |
| 6 | `packages/chat-ui/.../message/assistant-images.ts`（新 151 行） | 剥 `[XG-IMG-META]`（坏 JSON 只剥不崩）、`min(len)` 配对、caption=`alt`→`source`、角标=`host(page)`、**只认 http(s) 可点** |
| 7 | `.../assistant-images.css.ts`（新） | 网格/卡片样式，几何与测高公式同源 |
| 8 | `.../message.def.tsx` | 剥 marker + 配对 + 网格渲染 + 测高（**纯图消息不再多留一行文本高度**） |
| 9 | `.../reducer/decode.test.ts`（新 8 项） | |
| 10 | `.../message/assistant-images.test.ts`（新 10 项） | |

**桥侧配套**（`xiangwo_acp.py`，不在本仓）：新信号 `[XIANGWO_IMG=block]`（**不动 `protocol()` 取值** —— 那个值在 5 处被比，加值要同时改 5 处、漏一处就把球协议发给不认它的前端）；解析围栏块 → base64 图片块（**走字节 ⇒ 客户端在别的机器也能看图**）；一条 `[XG-IMG-META]` 元数据（与图片**同序同长**）。

**真链路抓到我自己三个 bug**（离线单测全绿也没用，详见 ACP 链 OPS）：① meta 与图片**错位** ② 整段路不剥**未闭合块** ③ 🔴 **顺序 bug**：流式尾部"扣半个锚"把**闭合围栏**当成开标记的前缀吃掉 ⇒ 完好的块整段漏 JSON。

### 31. [XG-CUSTOM 2026-10-10] 接通 **ACP 原生 `resource_link`** —— emdash 自己的「子产物」行

**背景**：用户「看下 emdash 自己有没有子产物的路」→ **有，而且只有 UI 那一半**：
ACP `ContentBlock` **原生含 `resource_link`**（SDK `schema/types.gen.d.ts:238-244`；`uri`·**`name` 必填**·`title?`·`description?`·`mimeType?`·`size?`），
chat-ui **原生有行组件**（`ChatResourceLink` + `components/rows/resource-link/*` + 已注册；`workspace-file`→**编辑器打开**、`external`→新标签），
**全仓 0 处生产者**（`decode.ts` 落 `ignored`；core 的 `transcriptItemSchema` 只有 message/thinking/toolNode）⇒ 用户明确要求「要 emdash 原生代码的接上」。

**改了 15 个文件**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/core/…/reducer/decode.ts` | `agent_message_chunk` 加 `resource_link` 分支：`uri`/`name` 都必填（空⇒`ignored`，不造半条）；`title/description/mimeType` 空串丢弃、`size` 只收有限非负数 |
| 2 | `packages/core/…/acp-transcript/api/normalized-event.ts` | 新增事件变体 |
| 3 | `packages/core/…/reducer/event-routing.ts` | **必须加的一处** —— 否则落 `turnId:null` 被静默丢弃（它不是 tool 事件、无法建立 owner） |
| 4 | `packages/core/…/reducer/ids.ts` | `makeResourceLinkId` → `${turnId}:resource-link:${ordinal}` |
| 5 | `packages/core/…/reducer/item-fold.ts` | **独立一行**（不与任何行 upsert）；`finalizeItems` 里无进行态 |
| 6 | `packages/core/…/models/turns/resource-links.ts`（新） | `resourceTargetSchema`（`workspace-file|external|opaque`）+ `transcriptResourceLinkSchema`（`target` **optional**：wire 上由桌面富化填） |
| 7 | `packages/core/…/models/turns/turn.ts` | 加入 `transcriptItemSchema` 联合（**不加就过 wire 被 zod strip**，有测试证明） |
| 8 | `packages/core/…/models/turns/index.ts` | 导出 |
| 9 | `apps/…/conversations/browser/acp/resource-link-enrichment.ts`（新） | `uri`→`target`：`http(s)`→external；**`/` 开头绝对路径**与 `file://`（含中文百分号解码）→workspace-file；其它→opaque；**幂等** |
| 10 | `apps/…/browser/acp/acp-chat-store.ts` | **唯一两个** `applyPage` 入口（首载 / 实时+翻页）都过富化 |
| 11 | `packages/chat-ui/…/resource-link/ResourceLink.tsx` | 🔴 **我补的防御**：`target` 缺省按 `opaque` 渲染 —— wire schema 必须保持 optional，**任何忘记富化的喂入路径都不该把整行渲染器打崩** |
| 12-15 | 三个测试文件 + `scripts/xg-custom/manifest.json`（台账） | decode +6 · schema 6 · 富化 10 |

**桥侧配套**（`xiangwo_acp.py`）：每张图额外发一条原生 `resource_link` —— **有来源作品页** ⇒ `uri`=http（external）；**没有**（pixelrag 这类本机图库）⇒ `uri`=**本机绝对路径**（workspace-file ⇒ **点开在编辑器里看产物本身**）。
两条上游契约据此调整：① `resource_link` 是"前台非内容事件"会 **closeContent 切断消息段** ⇒ 桥把**元数据发在链接之前**（否则那段文本另起一条空气泡）；② 上游**不渲染 `description`** ⇒ 来源标识并进 `title`（`样本龙领去.jpg · pixelrag`），`name` 保持文件名原样（它决定图标）。

**验证**：core/desktop/chat-ui typecheck 全 0 错 · 新单测 20+10 · chat-ui node 272/272 · 台账 **丢失0/漂移0/漏标0** · 真链路 **5 图 + 5 原生链接 + 0 机器标记** · 运行包取证（活挂载点 asar 含 `resource_link`×96 / `resolveResourceTarget`×2；对照串 0）。
**未验**：`workspace-file` 点 `/media/...` **没有实机点过**（只有静态追踪）；browser 测试项目缺 Playwright chromium ⇒ DOM 层无自动化证据。
