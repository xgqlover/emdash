import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import React from 'react';
import { SkillsPanel } from '@core/features/skills/contributions/browser/SkillsPanel';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export const SkillsView: React.FC = () => (
  <SkillsPanel
    host={LOCAL_HOST_REF}
    header={{
      title: 'Skills',
      description: t('extend_your_agents_with_reusable_skill_m'),
    }}
  />
);
