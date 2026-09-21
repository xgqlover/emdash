import { homedir } from 'node:os';
import { err, ok, type Result } from '@emdash/shared';
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

// [XG-CUSTOM] 多来源技能发现（Grok Build 原方式：Local > User > Paths 同名覆盖）
// Local 层 = {homeDir}/.agentskills（emdash 自装技能，优先级最高）
// User 层  = ~/.agents/skills（Grok Build 的 vendor 目录之一）
// Paths 层 = 中央技能库 skills-central（851 个，优先级最低）
// 用环境变量可覆盖来源路径，方便不同机器部署。
const USER_SKILLS_ROOT = process.env.EMDASH_USER_SKILLS_ROOT ?? `${homedir()}/.agents`;
const CENTRAL_SKILLS_ROOT =
  process.env.EMDASH_CENTRAL_SKILLS_ROOT ??
  '/persistent/home/xgqlover/天天项上/五层四维记忆系统/skills-central';

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
    const installed = await getInstalledSkills(this.deps.agentHost.fs, this.deps.agentHost.homeDir);
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

async function getInstalledSkills(fs: PluginFs, homeDir: string): Promise<CatalogSkill[]> {
  const provenance = await readSkillShInstalls(fs);
  const byId = new Map<string, CatalogSkill>();

  // [XG-CUSTOM] 从低优先级扫到高优先级；同名技能由高优先级覆盖（直接 set 覆盖）
  // Paths（中央库，最低）→ User（~/.agents/skills）→ Local（.agentskills，最高）
  await collectFromRoot(
    byId,
    createLocalPluginFs(CENTRAL_SKILLS_ROOT),
    CENTRAL_SKILLS_ROOT,
    '.',
    'central'
  );
  await collectFromRoot(
    byId,
    createLocalPluginFs(USER_SKILLS_ROOT),
    USER_SKILLS_ROOT,
    'skills',
    'user'
  );
  await collectFromRoot(byId, fs, homeDir, SKILLS_ROOT, undefined, provenance);

  return [...byId.values()];
}

async function collectFromRoot(
  byId: Map<string, CatalogSkill>,
  fs: PluginFs,
  root: string,
  dir: string,
  originRef: string | undefined,
  provenance?: Record<string, SkillShInstallRecord>
): Promise<void> {
  const entries = await fs.list(dir);
  for (const entry of entries) {
    if (entry === '.emdash' || entry.startsWith('.')) continue;
    const content = await fs.read(`${dir}/${entry}/SKILL.md`);
    if (!content) continue;
    const parsed = parseFrontmatter(content);
    const id = entry;
    // [XG-CUSTOM] 直接 set 覆盖：后扫（高优先级）的同名技能覆盖先扫（低优先级）
    const record = provenance?.[entry];
    byId.set(id, {
      id,
      installId: entry,
      displayName: parsed.frontmatter.name || entry,
      description: parsed.frontmatter.description || '',
      source: record ? 'skillssh' : 'local',
      sourceRef: record?.sourceRef ?? originRef,
      catalogSkillId: record?.catalogSkillId,
      skillShPath: record?.skillShPath,
      skillMdContent: content,
      frontmatter: parsed.frontmatter,
      installed: true,
      localPath: `${root}/${dir}/${entry}`,
    });
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
