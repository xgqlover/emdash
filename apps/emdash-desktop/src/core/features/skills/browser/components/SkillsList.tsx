import { CardGridSection } from '@emdash/ui/react/components';
import { Loader2 } from 'lucide-react';
import React, { useCallback } from 'react';
import { SkillCard } from '@core/features/skills/browser/components/SkillCard';
import type { UseSkillsResult } from '@core/features/skills/browser/components/useSkills';
import { useOpenModal } from '@core/manifests/browser/modal-api';
// [XG-CUSTOM] 技能分类清单（从 skills-central 归一化，_gen_skill_categories.py 生成）
import { SKILL_CATEGORY } from './skill-categories';

type SkillsListProps = {
  skills: UseSkillsResult;
  onOpenTerminal?: (skillPath: string) => void;
};

export const SkillsList: React.FC<SkillsListProps> = ({ skills, onOpenTerminal }) => {
  const openConfirm = useOpenModal('confirmActionModal');
  const openSkillDetail = useOpenModal('skillDetailModal');

  const handleUninstallRequest = useCallback(
    async (skillId: string): Promise<boolean> => {
      const displayName =
        skills.catalog?.skills.find((skill) => skill.id === skillId)?.displayName ?? skillId;
      const outcome = await openConfirm({
        title: 'Uninstall skill?',
        description: `This will uninstall "${displayName}" from all agents. This action cannot be undone.`,
        confirmLabel: 'Uninstall',
      });
      if (!outcome.success) return false;
      return skills.uninstall(skillId);
    },
    [openConfirm, skills]
  );

  const handleOpenDetail = useCallback(
    (skill: UseSkillsResult['filteredSkills'][number]) => {
      void openSkillDetail({
        skill,
        onInstall: skills.install,
        onUninstall: handleUninstallRequest,
        onOpenTerminal,
      });
    },
    [handleUninstallRequest, onOpenTerminal, openSkillDetail, skills.install]
  );

  if (skills.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  // [XG-CUSTOM 2026-10-09] 按大类分组。原实现只把分类用在 recommendedSkills 上，
  // 可所有来源的技能都是 installed ⇒ 中央库 941 项永远落进平铺的 Installed 区，分类一次都没生效。
  // 现在三块各自分组：外部只读来源 / emdash 自装 / 可安装；未分类排最后。
  const groupedExternal = groupByCategory(
    skills.installedSkills.filter((skill) => skill.readOnly === true),
    ' · 中央库（只读）'
  );
  const groupedInstalledLocal = groupByCategory(
    skills.installedSkills.filter((skill) => skill.readOnly !== true),
    ' · 已装'
  );
  const groupedRecommended = groupByCategory(skills.recommendedSkills, '');

  return (
    <div className="flex flex-col text-foreground">
      <div className="flex flex-col gap-8 pt-3 pb-8">
        {groupedExternal.map(([title, list]) => (
          <CardGridSection key={title} title={title}>
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={true}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => handleOpenDetail(skill)}
              />
            ))}
          </CardGridSection>
        ))}
        {groupedInstalledLocal.map(([title, list]) => (
          <CardGridSection key={title} title={title}>
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={true}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => handleOpenDetail(skill)}
              />
            ))}
          </CardGridSection>
        ))}
        {groupedRecommended.map(([category, list]) => (
          <CardGridSection key={category} title={category}>
            {list.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={false}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => handleOpenDetail(skill)}
              />
            ))}
          </CardGridSection>
        ))}
        {(skills.isSearchingSkillSh || skills.skillShSearchSkills.length > 0) && (
          <CardGridSection
            title={skills.isSearchingSkillSh ? 'Searching Skills.sh...' : 'Skills.sh'}
          >
            {skills.skillShSearchSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={false}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => handleOpenDetail(skill)}
              />
            ))}
          </CardGridSection>
        )}
      </div>
    </div>
  );
};

// [XG-CUSTOM 2026-10-09] 按大类分组渲染；suffix 用来区分「中央库（只读）」与「emdash 自装」
function groupByCategory(
  list: UseSkillsResult['filteredSkills'],
  suffix: string
): Array<[string, UseSkillsResult['filteredSkills']]> {
  const map = new Map<string, UseSkillsResult['filteredSkills']>();
  for (const skill of list) {
    const category = SKILL_CATEGORY[skill.id] ?? SKILL_CATEGORY[skill.installId ?? ''] ?? '未分类';
    const key = `${category}${suffix}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(skill);
  }
  return [...map.entries()].sort((a, b) => {
    const aNone = a[0].startsWith('未分类');
    const bNone = b[0].startsWith('未分类');
    if (aNone !== bNone) return aNone ? 1 : -1;
    return b[1].length - a[1].length;
  });
}
