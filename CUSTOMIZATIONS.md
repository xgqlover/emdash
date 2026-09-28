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
