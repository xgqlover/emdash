# [XG-CUSTOM] emdash 定制台账 + 检查器（三件套之二）

> **上游更新后，先跑这两条**（在 `emdash/` 下）：
> ```bash
> node scripts/xg-custom/check.mjs --check         # 三问：上游动了哪些定制文件 / 我们丢了/没标什么 / 下一步干嘛
> node scripts/xg-custom/check.mjs --gen           # 处理完刷新台账（改完代码也要跑这条）
> ```

解决的问题只有一个：**"上游一更新，改过的东西别全丢了。"**

## 三件套，缺一不可

| 件 | 是什么 | 缺了会怎样 |
|---|---|---|
| ① **标记** `[XG-CUSTOM]`（在代码里） | 定制点的**锚**。改 fork 代码时**一边改一边标** | 没有锚 → 上游覆盖后只能靠记忆找，等于全丢 |
| ② **台账** `manifest.json`（本目录，`--gen` 生成） | 每个定制文件：标记数 / 行号 / **锚点指纹** / 内容 hash / 首次引入提交 / 最近变更提交 / 一句话说明 | 没有台账 → 标记散落在 108 个文件里，没人知道"总共该有多少处"，丢 3 处不会有人发现 |
| ③ **检查器** `check.mjs`（本目录） | `--check` 一次回答升级三问（上游动了哪些定制文件 / 我们丢了&没标什么 / 下一步干嘛）；`--after-merge` 只跑「定制点清点」 | 没有检查器 → 台账只是死数据，不会自己报警 |

> 只要「标记 + 台账」没有检查器，就是**事后考古**；加上检查器才是**事前拦截**。

## 设计取舍：**以标记为锚点，hash 只作辅助**

上游 rebase / merge 之后，凡是我们定制过的文件，**blob hash 必然全变**（行号也整体漂移）。
所以「hash 一致」**绝不能**当"定制还在"的判据。判定优先级是：

| 级别 | 判据 | 抗不抗 rebase | 说明 |
|---|---|---|---|
| ① 文件级 | 这个文件现在还有没有 `[XG-CUSTOM]` | ✅ | 一条 `git grep -F` 就能查 |
| ② 锚点级（主力） | 每个标记的**锚点指纹**还在不在 | ✅ 抗行号漂移 | 见下 |
| ③ 内容 hash | 文件字节有没有变 | ❌ 必变 | **只**用来区分「一字未动」/「上游改了周边 → 刷新台账」 |

**锚点（anchor）怎么取的**（`--gen` 时算好，存进台账）：

1. 标记**同一行左边**的代码（inline 标记，最常见）：`const x = 1; // [XG-CUSTOM] …` → 锚点 `const x = 1;`
2. 标记**独占一行**时 → 往下 15 行内第一行"像代码"的行（跳过注释块正文/散文）
3. 标记在**文件头注释块**里（如 `orb.js` 顶部 40 行说明）→ 用标记后面**我们自己写的那句说明**当指纹
4. 指纹在文件里**不唯一**（比如 `return;`，一个文件里有 4 个）→ 自动升级成**窗口指纹**
   `上一行非空行 ⏎ return;`，避免误命中别处

判定时按**整行精确匹配**（+ 长行前缀匹配），所以上游把 `return;` 改成 `return void 0;` 会被抓到，
而 `const x = 1;` 后面被上游补一句 `// note` 不会误报。

**台账里的 `lines[]` 只是展示辅助**（生成时行号，rebase 后必然漂移，别拿它做判据）；
**捞回也不靠行号**，靠 `git log -S'[XG-CUSTOM]' -- <file>`（按内容找提交）。

### 为什么不能只靠 hash

| 只比 hash 会怎样 | 实际后果 |
|---|---|
| 上游 rebase / merge 后，我们定制过的文件 **hash 100% 变**（哪怕一个字都没动我们的定制） | 满屏"文件都变了" → **报警疲劳**，真丢的那几处被淹掉 |
| 上游只改了周边代码（加一个 import、挪一段注释） | hash 变 → 误报"定制丢了"，其实定制好好的 |
| 上游把**带标记的整个函数重写掉**，但文件里别处还有我们的标记 | hash 变 → 但"标记数没少"，纯比 hash 的脚本会当没事，**真丢的定制漏掉** |

所以 hash 在本套件里的**唯一用途**是：区分「一字未动」/「上游改了周边（→ `--gen` 刷新台账）」。
**判"定制还在不在"只认标记 + 锚点指纹**。台账同时存 hash 只是给 `--gen` 一个"要不要刷新"的信号，以及给
人工一个"这个文件在上游更新后有没有动过"的参考。

## 命令

```bash
node scripts/xg-custom/check.mjs --gen          # 重新生成台账（幂等：同一工作区两次生成字节一致）
node scripts/xg-custom/check.mjs --check        # 升级上游那一刻的「三问」全在这里（见下）
node scripts/xg-custom/check.mjs --list         # 打印台账（文件 / 行号 / 说明 / 当前实际标记数）
node scripts/xg-custom/check.mjs --after-merge  # 只看定制点清点（--check 的 2.1 节单独跑）
# 可选：--base <sha>  --upstream <ref>（默认 origin/main）  --strict  --limit <n>  --no-color
```

`--check` 的输出就是**升级上游时最关心的三个问题**（按这个顺序排的）：

| 节 | 回答的问题 | 你会拿到什么 |
|---|---|---|
| **一、上游这次动了我们哪些定制文件** | ① 哪些文件有冲突/被覆盖风险 | 🔴 上游删了我们的定制文件 / 🟠 上游新增了同名文件 / 🟡 上游也改了这些文件（每条附**上游最近提交 + 我们最近提交**） |
| **二、我们的定制点：丢了没有 / 有没有漏标** | ② 哪些定制点丢了、哪些没标 | 2.1 丢失（**文件:行号** + 锚点对不上的原文 + `git log -S` / `git show` 捞回命令）<br>2.2 漏标（`文件:行号` + 那一行内容）<br>2.3 台账时效 |
| **三、下一步（直接复制粘贴）** | ③ 跑完该干嘛 | 按当前状态给出的命令序列（捞回 → 补标 → `--gen` → 复查 → 提交） |

退出码（可进 CI / git hook / pre-push）：

| 命令 | 退出码 1 的条件 |
|---|---|
| `--check` | ② 有丢失 / 有**新漏标**（已入账文件里的无标记 hunk）/ 台账与实际不一致 / ① 上游删了或新增了我们定制的文件；加 `--strict` 连「未入账文件」历史欠账一起拦 |
| `--after-merge` | 有定制点疑似丢失（标记没了 / 标记少了 / 锚点对不上） |
| `--gen` / `--list` | 只用 2 表示用法错误 |

## 已实测：三种「丢定制」场景（别只信文档）

在临时副本（`git worktree add --detach /tmp/xg-lost-test HEAD`，主工作区不受影响）里故意破坏，实跑结果：

| 场景 | 造的破坏 | `--check` / `--after-merge` 的判定 |
|---|---|---|
| A 上游整体覆盖 | 删掉 `update-service.ts` 的标记行 | 🔴 `标记全没了 update-service.ts:77`（台账 1 处 → 现在 0）+ `git log -S` / `git show 7fbf04b50` 捞回命令 |
| B 上游重写带标记的函数 | 保留 3 处标记，把守护代码 `enrich: enrichXiangwoUpdate,` 改成上游实现 | 🔴 `定制点疑似丢 1 处 xiangwo/index.ts:1,27,45`：标记在（3 处）但**锚点对不上** `enrich: enrichXiangwoUpdate,` |
| C 只动周边 | 在 `orb.js` 末尾追加一行上游注释 | 🟡 只算「上下文漂移」（丢失 0）→ 提示 `--gen` 刷新，**不误报丢失** |

> 场景 B 是最能说明"为什么不能只靠标记数、也不能只靠 hash"的一例：标记一个没少、hash 也变了，
> 只有**锚点指纹**能指出"这个定制点被换掉了"。

## 升级上游的标准流程（rebase 版）

```bash
cd emdash
# 0) 先固化现状（拿到"更新前的定制快照"，--check 才有正确基准）
node scripts/xg-custom/check.mjs --gen
git add scripts/xg-custom/manifest.json && git commit -m "chore(xg-custom): 合并上游前刷新台账"

# 1) 拉上游（origin 是只读的上游，push 会 403；我们的 remote 是 xgqlover）
git fetch origin

# 2) rebase / merge（二选一；我们的历史里有 merge 先例，rebase 更适合小步跟版）
git rebase origin/main          # 或： git merge origin/main

# 3) 体检（一条命令回答「上游动了哪些定制文件 / 我们丢了什么 / 没标什么 / 下一步干嘛」）
node scripts/xg-custom/check.mjs --check
#    一、上游动了我们哪些定制文件   ← 冲突高危清单（文件 + 上游/我们各自最近提交）
#    二、2.1 丢失（文件:行号 + 捞回命令）/ 2.2 漏标 / 2.3 台账时效
#    三、下一步（按你的状态给命令）

# 4) 捞回 + 补标：按第 3 步输出的命令逐条处理（改一行标一行，别攒）

# 5) 刷新台账并提交
node scripts/xg-custom/check.mjs --gen
git add scripts/xg-custom/manifest.json
git commit -m "chore(xg-custom): 上游同步后刷新定制台账（N 文件 / M 处标记）"

# 6) 复查：2.1/2.2 应回到 ✅
node scripts/xg-custom/check.mjs --after-merge     # 只看定制点清点（等价于 --check 的 2.1 节）
```

**捞回定制点**（`--check` 的 2.1 节会直接把这两条命令打出来，连提交号都填好）：

```bash
git log --all -S'[XG-CUSTOM]' --format='%h %ad %s' --date=short -- <file>   # 哪几次提交动过这个文件的标记
git show <提交> -- <file>                                                  # 看当时怎么改的，手工重贴
node scripts/xg-custom/check.mjs --list                                    # 看该文件台账里的锚点/行号
node scripts/xg-i18n/apply.mjs --check                                     # 如果是中文化丢了，走行级对照表还原
```

⚠️ **别直接 `git checkout <提交> -- <file>`**：那会把上游这一版的新代码一起覆盖掉（除非整个文件就是我们的）。
正确姿势是 `git show` 看 diff → 手工重贴那几行。

## 上游大版本更新（跟版）时的用法

1. **动手前**：`--gen` + 提交台账（"更新前定制快照"）。记下 `git rev-parse HEAD`。
2. **合并**：`git fetch origin && git rebase origin/main`（或 merge）。冲突多就按"保留定制"原则逐个解。
3. **一条命令体检**：`--check`。
   - **一、上游动了哪些定制文件** → 高危清单；`🔴 上游删除` 要改挂载点，`🟡 上游同改` 就是刚才冲突的那些文件。
   - **2.1 丢失** → 按每条自带的 `git log -S` / `git show` 捞回，重贴时补 `[XG-CUSTOM]`。
   - **2.2 漏标** → `🔴` 必须补；`🟠` 是历史欠账（见下），可以分批补。
   - **三、下一步** → 照抄命令（捞回 → 补标 → `--gen` → 复查 → 提交）。
4. **构建验证**：`pnpm --dir apps/emdash-desktop run typecheck` + 打包/重启后按界面点一遍（至少：球 / 项我对话 / 交接台 / 变更面板 / 设置页集成卡片）。
5. **收尾**：`--gen` → 提交台账 + 一句 `chore(xg-custom): 跟版 vX.Y.Z 后刷新台账`。
6. **回归确认**：`--after-merge` 应回到 `✅ 定制点都在`；`--check` 的 🔴 应为 0。

## 与 `scripts/xg-i18n/` 的分工（别混）

| | `scripts/xg-i18n/` | `scripts/xg-custom/`（本目录） |
|---|---|---|
| 管什么 | **中文化**这一件事：行级对照表 + `--apply` 还原 | **所有定制**：标记台账 + 漏标/丢失检查 |
| 粒度 | 「上游英文原行 → 我们的中文行」的**行级替换** | 「哪些文件/哪些锚点是我们改的」的**清点** |
| 丢了怎么救 | `apply.mjs --apply` **自动还原**（行级对照） | `--after-merge` 定位 + `git show` **手工重贴** |
| 关系 | 是"定制"的一个子集 | 是总账；中文化文件也在本台账里（若打了标记） |

中文化文件如果丢了，先跑 `xg-i18n/apply.mjs --check`（有对照表就能自动补），本检查器负责告诉你有**哪些**文件受影响。

## 台账里为什么没有这些文件

- `scripts/xg-custom/**`（本目录）：`manifest.json` 自己要引用 `[XG-CUSTOM]` 文本，入账会**自指**
  （生成结果依赖生成结果）→ 台账就不幂等了。所以本目录自我排除。
- `*.md`（如根目录 `CUSTOMIZATIONS.md`、`scripts/xg-i18n/README.md`）：人读清单，由别的会话维护
  （多个人在写），且没有"代码定制点"可锚 → 不入账。
- `.github/electron-builder-cache|bin/**`、`pnpm-lock.yaml`、`out|dist|release/`：噪音（仓库里
  被提交进来的打包缓存有 459 个文件），入账会把报告淹掉。

## 当前审计（2026-09-30，基点 `669a24fe6`）

| 项 | 数字 |
|---|---|
| 相对基点的改动文件 | **187**（不含 `.github/electron-builder-*` 打包缓存；其中 183 个有文本增删） |
| 标记总量（全仓 `git grep -c`） | **110 文件 / 453 处** |
| 台账条数（本目录，排除 `*.md` 与本目录） | **108 文件 / 441 处** |
| 其中：我们新增的文件 / 改动上游的文件 | 50 / 58 |
| `--check` 2.1 丢失（对台账锚点） | 🔴 **0**（完好 108 / 仅漂移 0）—— 定制点一个没丢 |
| `--after-merge` 基线 | ✅ 一字未动 108 / 漂移 0 / 丢失 0 |
| `--check` 2.2 漏标 | 🔴 **8 处**（已入账文件里的新漏标）+ 🟠 **67 个未入账文件**（历史欠账） |
| `--check` 一节 上游风险 | 上游删除 0 / 上游新增同名 0 / **上游同改 5**（`acp-chat-panel` b235e09f4、`acp-chat-store` 3bd3a2e24、`create-task-modal` 5c37fe641、`task-name-field` 3a58486da、`bootstrap/boot/phases/services` 5c37fe641） |

**历史欠账说明（不是本轮引入的）**：67 个"未入账文件"绝大多数是**中文化批处理时没打
`[XG-CUSTOM]` 标记**的组件（`import { t } from '@renderer/lib/i18n'` 是它们唯一的定制证据）。
它们的定制内容目前靠 `scripts/xg-i18n/manifest.json`（行级对照表）+ git 历史兜着，
**暂时没丢**，但不在本台账的清点范围内。补法很简单：在这些文件的中文化 import 那行补
`// [XG-CUSTOM]`（或在文件头加一行标记）→ `--gen` → 它们就入账了。建议后续按 feature 分批补，
一次别改太多（本目录只加脚本/文档，本轮不动这些文件）。

## 踩过的坑（改这个脚本时别再犯）

1. `execFileSync('git', ...)` **必须显式指定 `stdio`**：否则 `cat-file -e` 探测不存在路径时的
   `fatal: path ... exists on disk, but not in <rev>` 会直接喷到终端，报告没法看。
2. **锚点不能只取"标记后面第一行"**：注释块（`orb.js` 顶部 40 行说明）里那叫散文，不是代码 →
   要么往下足够远（15 行）找"像代码"的行，要么干脆用标记后那句说明当指纹。
3. **锚点必须去重/升级窗口**：`return;` 这种一行文件里出现 4 次的指纹会误命中别处，
   让"代码被重写"检测失效 → 生成时统计同文件内出现次数，>1 就升级成 `上一行 ⏎ 本行` 窗口指纹。
4. **判定用整行精确匹配**，别用 `content.includes(anchor)`：后者会让 `return;` 命中 `return void 0;` 之外
   无关的 `return;`，也可能让 `const x` 命中 `const x2`。
5. **`--gen` 要幂等**：别写时间戳/HEAD 进台账（HEAD 每次提交都变 → 台账天天脏）。
   本台账只存 `upstream.base`（rebuild 后才变）→ 同一工作区两次 `--gen` 字节一致（`md5sum` 可验）。
6. **测试时别污染仓库**：模拟上游覆盖用 `git show <base>:<file> > <file>`（不动索引），
   测完 `git checkout -- <file>` 恢复，最后 `git status --porcelain` 应为空。

## 新增定制/改 fork 代码的流程（写进日常习惯）

1. 改代码 **一边改一边标** `[XG-CUSTOM]`（标记 + 一句话说明，为什么改）；
2. 跑 `node scripts/xg-custom/check.mjs --gen`（新文件入账、标记数更新）；
3. 跑 `node scripts/xg-custom/check.mjs --check`（确认没有新漏标）；
4. 把 `manifest.json` 跟代码**一起提交**（台账和代码分开提交 = 下一次审计基准是错的）。
