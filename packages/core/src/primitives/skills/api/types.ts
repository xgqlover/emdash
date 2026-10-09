export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
}

export interface CatalogSkill {
  id: string;
  installId?: string;
  displayName: string;
  description: string;
  // [XG-CUSTOM 2026-10-09] 'central' = 项上集团中央技能库（skills-central，外部只读来源）
  source: 'openai' | 'anthropic' | 'skillssh' | 'local' | 'central';
  sourceUrl?: string;
  iconUrl?: string;
  brandColor?: string;
  defaultPrompt?: string;
  sourceRef?: string;
  catalogSkillId?: string;
  skillShPath?: string;
  installs?: number;
  skillMdContent?: string;
  frontmatter: SkillFrontmatter;
  installed: boolean;
  localPath?: string;
  // [XG-CUSTOM 2026-10-09] 外部来源（中央库 / User 层）只读：
  // 它们不是 emdash 装的，不允许在 emdash 里卸载（卸载会 rm -rf 到外部目录）
  readOnly?: boolean;
}

export interface CatalogIndex {
  version: number;
  lastUpdated: string;
  skills: CatalogSkill[];
}
