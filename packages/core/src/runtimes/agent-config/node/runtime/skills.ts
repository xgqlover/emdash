import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import {
  generateSkillMd,
  isValidSkillName,
  parseFrontmatter,
  type CatalogSkill,
} from '#primitives/skills/api';
import type { AgentConfigSkillsError } from '#runtimes/agent-config/api';
import type { AgentConfigSkillsModel } from '#runtimes/agent-config/node/state/live-models';
import { publishLiveModelState } from '#runtimes/agent-config/node/state/live-models';
import type { PluginFs } from '#services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '#services/agent-plugins/api/plugins/helpers';
import type { AgentConfigRuntimeDeps } from './types';

const SKILLS_ROOT = '.agentskills';
const EMDASH_META = `${SKILLS_ROOT}/.emdash`;
const SKILLSH_INSTALLS_PATH = `${EMDASH_META}/skillssh-installs.json`;
// [XG-CUSTOM 2026-10-09] Grok Build 式来源配置（可选）：`{ "paths": [...], "ignore": [...] }`
// 放在 {homeDir}/.agentskills/.emdash/skills-config.json，或用 EMDASH_SKILLS_CONFIG 指到别处
// （后者是「按 bot 各配一份」的落点）。`disabled` 暂不实现，原因见 emdash-运行经验-OPS.md「二十五·补」。
const SKILLS_CONFIG_PATH = `${EMDASH_META}/skills-config.json`;

type SkillsConfig = {
  /** 额外只读技能来源（中央库之外的库，优先级最低） */
  paths?: string[];
  /** 完全不进列表的技能名 */
  ignore?: string[];
};

// [XG-CUSTOM 2026-10-09] 多来源技能发现（Grok Build 原方式：Local > User > Paths 同名覆盖）
// Local 层 = {homeDir}/.agentskills（emdash 自装技能，优先级最高，唯一可卸载的层）
// User 层  = ~/.agents/skills（Grok Build 的 vendor 目录之一）
// Paths 层 = 中央技能库 skills-central（2026-10-09 实测 919 个 SKILL.md，优先级最低）
// 外部来源（User / Paths）一律 readOnly —— 它们不是 emdash 装的，卸载会 rm -rf 到外部目录。
// 用环境变量可覆盖来源路径，方便不同机器部署。
const USER_SKILLS_ROOT = process.env.EMDASH_USER_SKILLS_ROOT ?? `${homedir()}/.agents`;
const CENTRAL_SKILLS_ROOT =
  process.env.EMDASH_CENTRAL_SKILLS_ROOT ??
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/skills-central';

type SkillSourceRoot = { root: string; dir: string; origin: string };

type SkillInstallPayload = {
  id: string;
  installId?: string;
  skillMdContent: string;
  source?: CatalogSkill['source'];
  sourceRef?: string;
  catalogSkillId?: string;
  skillShPath?: string;
  iconUrl?: string;
};

type SkillShInstallRecord = {
  sourceRef: string;
  catalogSkillId: string;
  skillShPath: string;
};

export class AgentSkillsManager {
  private list: CatalogSkill[] = [];

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly model: AgentConfigSkillsModel
  ) {}

  async initialize(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<CatalogSkill[]> {
    const installed = await getInstalledSkills(
      this.deps.agentHost.fs,
      this.deps.agentHost.homeDir,
      this.deps.logger
    );
    this.publish(installed);
    return installed;
  }

  async installSkill(
    payload: SkillInstallPayload
  ): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    const installId = payload.installId ?? payload.id;
    if (!isValidSkillName(installId)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${installId}"` });
    }
    try {
      await this.deps.agentHost.fs.write(
        `${SKILLS_ROOT}/${installId}/SKILL.md`,
        payload.skillMdContent
      );
      if (
        payload.source === 'skillssh' &&
        payload.sourceRef &&
        payload.catalogSkillId &&
        payload.skillShPath
      ) {
        const installs = await readSkillShInstalls(this.deps.agentHost.fs);
        installs[installId] = {
          sourceRef: payload.sourceRef,
          catalogSkillId: payload.catalogSkillId,
          skillShPath: payload.skillShPath,
        };
        await writeSkillShInstalls(this.deps.agentHost.fs, installs);
      }
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async removeSkill(name: string): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    try {
      // [XG-CUSTOM 2026-10-09] 只允许卸载 emdash 自己装的（Local 层）。
      // 外部只读来源（中央库 / User 层）一律拒绝：老实现无条件 `delete('.agentskills/'+name)`，
      // 一旦 .agentskills 是指向中央库的软链，就会把 skills-central/<name> 整个 rm -rf 掉。
      if (await isExternalSkill(this.deps.agentHost.fs, name)) {
        return err({
          type: 'invalid-state',
          message: `"${name}" 来自外部只读技能库（中央库 / User 层），不能在 emdash 里卸载`,
        });
      }
      await this.deps.agentHost.fs.delete(`${SKILLS_ROOT}/${name}`);
      const installs = await readSkillShInstalls(this.deps.agentHost.fs);
      if (installs[name]) {
        delete installs[name];
        await writeSkillShInstalls(this.deps.agentHost.fs, installs);
      }
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  async createSkill(input: {
    name: string;
    description: string;
    content?: string;
  }): Promise<Result<CatalogSkill[], AgentConfigSkillsError>> {
    if (!isValidSkillName(input.name)) {
      return err({ type: 'invalid-state', message: `Invalid skill name: "${input.name}"` });
    }
    try {
      const existing = await this.deps.agentHost.fs.exists(`${SKILLS_ROOT}/${input.name}/SKILL.md`);
      if (existing) {
        return err({ type: 'invalid-state', message: `Skill "${input.name}" already exists` });
      }
      await this.deps.agentHost.fs.write(
        `${SKILLS_ROOT}/${input.name}/SKILL.md`,
        generateSkillMd(input.name, input.description, input.content)
      );
      return ok(await this.refresh());
    } catch (error) {
      return err(toIoError(error));
    }
  }

  private publish(list: CatalogSkill[]): void {
    const previous = this.list;
    this.list = list;
    publishLiveModelState(this.model.states.list, list, previous);
  }
}

function toIoError(error: unknown): AgentConfigSkillsError {
  return { type: 'io', message: error instanceof Error ? error.message : String(error) };
}

async function getInstalledSkills(
  fs: PluginFs,
  homeDir: string,
  logger?: Logger
): Promise<CatalogSkill[]> {
  const provenance = await readSkillShInstalls(fs);
  const config = await readSkillsConfig(fs);
  const skip = new Set(config.ignore ?? []);
  const byId = new Map<string, CatalogSkill>();

  // [XG-CUSTOM] 从低优先级扫到高优先级；同名技能由高优先级覆盖（直接 set 覆盖）
  // Paths（中央库 + 额外 paths，最低）→ User（~/.agents/skills）→ Local（.agentskills，最高）
  for (const source of externalSkillRoots(config)) {
    await collectFromRoot(
      byId,
      createLocalPluginFs(source.root),
      source.root,
      source.dir,
      source.origin,
      skip,
      logger
    );
  }
  await collectFromRoot(byId, fs, homeDir, SKILLS_ROOT, undefined, skip, logger, provenance);

  return [...byId.values()];
}

// [XG-CUSTOM 2026-10-09] 外部只读来源清单（数组顺序即优先级：低 → 高）
function externalSkillRoots(config: SkillsConfig): SkillSourceRoot[] {
  const roots: SkillSourceRoot[] = [{ root: CENTRAL_SKILLS_ROOT, dir: '.', origin: 'central' }];
  for (const extra of config.paths ?? []) {
    if (extra.trim()) roots.push({ root: extra, dir: '.', origin: 'paths' });
  }
  roots.push({ root: USER_SKILLS_ROOT, dir: 'skills', origin: 'user' });
  return roots;
}

async function collectFromRoot(
  byId: Map<string, CatalogSkill>,
  fs: PluginFs,
  root: string,
  dir: string,
  originRef: string | undefined,
  skip: ReadonlySet<string>,
  logger?: Logger,
  provenance?: Record<string, SkillShInstallRecord>
): Promise<void> {
  const entries = await fs.list(dir);
  for (const entry of entries) {
    if (entry === '.emdash' || entry.startsWith('.')) continue;
    if (skip.has(entry)) continue;
    let content: string | null = null;
    try {
      content = await fs.read(`${dir}/${entry}/SKILL.md`);
    } catch (error) {
      // [XG-CUSTOM 2026-10-09] 单个技能读不出来（EACCES / 坏软链 / 目录不可进）不能让整次发现失败。
      // 2026-10-08 事故：中央库一个 root:0600 的 SKILL.md（lean-ctx）让 agent-config worker 连崩 6 代 ——
      // 中央库是第一个扫的，抛在这里 ⇒ 后面各层一次都没跑到，技能列表整体不发布。
      logger?.warn('[skills] 跳过读不出来的技能', {
        path: `${root}/${dir}/${entry}/SKILL.md`,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!content) continue;
    const parsed = parseFrontmatter(content);
    const id = entry;
    // [XG-CUSTOM] 直接 set 覆盖：后扫（高优先级）的同名技能覆盖先扫（低优先级）
    const record = provenance?.[entry];
    // [XG-CUSTOM 2026-10-09] 外部来源统一标 source:'central' + readOnly：
    // UI 据此把「中央库/User 层」与「emdash 自装」分开，并且不给外部来源卸载按钮。
    const external = originRef !== undefined;
    byId.set(id, {
      id,
      installId: entry,
      displayName: parsed.frontmatter.name || entry,
      description: parsed.frontmatter.description || '',
      source: external ? 'central' : record ? 'skillssh' : 'local',
      sourceRef: record?.sourceRef ?? originRef,
      catalogSkillId: record?.catalogSkillId,
      skillShPath: record?.skillShPath,
      skillMdContent: content,
      frontmatter: parsed.frontmatter,
      installed: true,
      readOnly: external || undefined,
      localPath: `${root}/${dir}/${entry}`,
    });
  }
}

// [XG-CUSTOM 2026-10-09] 名字是否来自外部只读来源（卸载前置校验，防「删库」）
async function isExternalSkill(fs: PluginFs, name: string): Promise<boolean> {
  // 非法技能名（含 `..` / `/`）一律按「不许删」处理
  if (!isValidSkillName(name)) return true;
  const config = await readSkillsConfig(fs);
  for (const source of externalSkillRoots(config)) {
    const content = await createLocalPluginFs(source.root)
      .read(`${source.dir}/${name}/SKILL.md`)
      .catch(() => null);
    if (content) return true;
  }
  return false;
}

// [XG-CUSTOM 2026-10-09] 可选来源配置：{ "paths": [...], "ignore": [...] }
async function readSkillsConfig(fs: PluginFs): Promise<SkillsConfig> {
  const override = process.env.EMDASH_SKILLS_CONFIG;
  const raw = override ? await readFileSafe(override) : await fs.read(SKILLS_CONFIG_PATH);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as SkillsConfig;
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    return { paths: strings(parsed.paths), ignore: strings(parsed.ignore) };
  } catch {
    return {};
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function readSkillShInstalls(fs: PluginFs): Promise<Record<string, SkillShInstallRecord>> {
  const raw = await fs.read(SKILLSH_INSTALLS_PATH);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, SkillShInstallRecord>;
  } catch {
    return {};
  }
}

async function writeSkillShInstalls(
  fs: PluginFs,
  records: Record<string, SkillShInstallRecord>
): Promise<void> {
  await fs.write(SKILLSH_INSTALLS_PATH, JSON.stringify(records, null, 2));
}
