# [XG-CUSTOM] emdash 中文化：标记 / 体检 / 还原

> **emdash 上游更新后，先跑这一条**：
> ```bash
> node scripts/xg-i18n/apply.mjs --check      # 体检：哪些中文被覆盖了（有丢失则退出码 1）
> node scripts/xg-i18n/apply.mjs --apply      # 还原：把被覆盖的中文改回来
> ```

## 为什么需要它

上游 emdash 是英文原文写死在组件里的。我们的中文化 = 把那些英文字面量换成 `t('key')`，
key 放在**我们自己的语言包** `apps/emdash-desktop/src/renderer/lib/i18n/locales.ts`（zh/en 双包）。

上游一更新，两种情况会丢中文：

| 情况 | 后果 | 怎么救 |
|---|---|---|
| 上游改了同一个组件文件 | 我们的 `t('...')` 被上游的英文字面量覆盖 | `apply.mjs --apply` 还原（行级对照表） |
| 上游没动 `locales.ts`（它没有这个文件） | 不受影响 | —— |
| `locales.ts` 被整体覆盖/删掉 | 所有 key 没了 | `git checkout <提交> -- apps/emdash-desktop/src/renderer/lib/i18n/locales.ts` |

## 三件套

| 文件 | 作用 |
|---|---|
| `scripts/xg-i18n/manifest.json` | **行级对照表**：每个文件里「上游英文原行 → 我们的中文行」，共 103 条 / 19 个文件，随每次中文化继续追加 |
| `scripts/xg-i18n/apply.mjs` | **还原器**：`--check` 只体检、`--apply` 才写文件。只做**整行精确匹配**，匹配不到就报 MISSING（绝不模糊替换，防止误伤上游新代码） |
| `apps/emdash-desktop/src/renderer/lib/i18n/locales.ts` | 语言包本体（`// [XG-CUSTOM]` 头注释），zh/en key 必须一一对应 |

## 代码里的标记怎么看

- 每个被中文化的组件文件都有一行（`grep -rn "XG-CUSTOM" apps/emdash-desktop/src | grep i18n`）：
  ```ts
  import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]
  ```
- 具体哪几行被换过 → 查 `manifest.json`（这就是"标记"，比在每行后面撒 `// [XG-CUSTOM]` 干净，也不干扰 oxfmt 排序）
- 新增中文化文案的标准流程：
  1. `locales.ts` 的 **zh 和 en 两处**都加 key（少一边会 TS 报错）
  2. 组件里 `t('key')` 替换英文字面量
  3. 把 `[原行, 中文行]` 追加进 `manifest.json`（或重跑一次抽取）
  4. `pnpm --dir apps/emdash-desktop run typecheck`
  5. 重新打包 + 重启实例，asar 内 `grep` 中文串确认

## 踩过的坑（写脚本时别再犯）

1. **按钮文案常在多行 JSX 子节点**（`>\n  Stage\n</Button>`）→ 只抓 `>Text<` 会漏
2. 通用替换 `"X"` → `t('x')` 会给 **JSX 属性漏大括号**（`label=t('x')` 非法）→ 要回补 `={t('x')}`
3. import 插入点必须是「**最后一个以 `;` 结尾的 import 行**」之后；用「最后一个 `import ` 开头的行」会把多行 import 劈开（会 TS1003/TS1005）
4. 新 key 可能与已有 key **重名**（TS1117 An object literal cannot have multiple properties）→ 加完必查重
5. 验证方式：`git checkout <中文化之前的提交> -- <某文件>` 模拟上游覆盖 → `--check` 应报"待还原" → `--apply` → `git diff HEAD -- <文件>` **应为空**（⚠️ 测试时 `git checkout <commit> -- <file>` 会同时改索引，别被 `git diff` 的方向骗了，用 `git diff HEAD`，测完 `git reset`）

## 当前进度

- 已中文化：**变更面板**（变更/全部文件/全部暂存/全部丢弃/取消暂存/提交信息/详细描述/提交并推送/已暂存）、**PR 区块**（拉取请求/建 PR/建草稿 PR/基线分支/源分支/标题/刷新）、**diff 工具条**（变更/已暂存/（工作区）/（已暂存）/原始/修改后/加载中/未命名）、**任务标题栏**（变更/文件/对话切换器、终端抽屉、关联议题）、**活动**徽标
- 未做：侧边栏底部 `Search…`；其它功能页（自动化、设置、交接台等）按需继续
