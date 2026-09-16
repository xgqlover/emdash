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
