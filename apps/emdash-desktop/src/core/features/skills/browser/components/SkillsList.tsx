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

  // [XG-CUSTOM] 按分类分组中央技能（847 平铺 → 按大类分组），未分类排最后
  const groupedRecommended = (() => {
    const map = new Map<string, UseSkillsResult['filteredSkills']>();
    for (const s of skills.recommendedSkills) {
      const cat = SKILL_CATEGORY[s.id] ?? SKILL_CATEGORY[s.installId ?? ''] ?? '未分类';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(s);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '未分类') return 1;
      if (b[0] === '未分类') return -1;
      return b[1].length - a[1].length;
    });
  })();

  return (
    <div className="flex flex-col text-foreground">
      <div className="flex flex-col gap-8 pt-3 pb-8">
        {skills.installedSkills.length > 0 && (
          <CardGridSection title="Installed">
            {skills.installedSkills.map((skill) => (
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
        )}
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
