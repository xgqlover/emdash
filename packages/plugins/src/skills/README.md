# skills —— pstack 的 skill 装进 emdash 原生 plugin 机制

[XG-CUSTOM 2026-10-28] 用户口径：「你可以按 emdash 原生机制改一下运行方式合过来」。

- **不引入 Cursor/Claude Code 运行时**：skill 的语义（name/description/正文 + 触发条件）保留，
  装载换成 emdash 自己的 `packages/shared/src/plugins/`（`createPluginRegistry` / capability）。
- **不是第二套 playbook 真源**：我们的 `scripts/xg_playbook_route.py` 决定"用哪套套路"，
  这里的 skill 决定"这套套路被调用时按什么判据跑"。
- **外来的必须记 `upstreamPath`**（指到 `代码仓库/cursor-plugins/pstack/skills/<名>/SKILL.md`），
  否则下次无法判断它是否被上游改过。

## 现有 3 个（样板，不是全量）

| id | 上游 | 为什么先搬它 |
|---|---|---|
| `pstack/create-verification-skill` | `skills/create-verification-skill` | 把守卫从"脚本清单"升级成"可被 agent 调用的技能（含 doctor + 证据标准）" |
| `pstack/principle-encode-lessons-in-structure` | 同名 | 我们已在 OPS 里引用它，却**没把它变成判据** |
| `pstack/principle-guard-the-context-window` | 同名 | 补"整个回合的预算"这一层（比 `kb_map` 四层更外） |

守卫：`scripts/_test_skills_registry.py`（id 唯一 / entry 真实存在 / upstreamPath 能在上游仓里找到 / registry 全覆盖）。
