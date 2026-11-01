import { PageLayout, SettingsCard } from '@emdash/ui/react/patterns';
import { useMemo } from 'react';
import { HostSettingsCard } from '../components/host-settings-card';
import { ResourceUtilizationRow } from '../components/machine-resources';
import { MachineSystemDependenciesCard } from '../components/machine-system-dependencies';
import { createSystemDependenciesStore } from '../machines-store';
import { useMachineMetrics } from '../use-machine-metrics';
import { t } from '@renderer/lib/i18n'; // [XG-CUSTOM]

export function SystemSettingsPage() {
  const metrics = useMachineMetrics(undefined, true);
  const systemDependenciesStore = useMemo(() => createSystemDependenciesStore(), []);

  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="System"
        description={t('monitor_local_host_resources_and_require')}
      />
      <SettingsCard>
        <ResourceUtilizationRow metrics={metrics} />
      </SettingsCard>
      <HostSettingsCard />
      <MachineSystemDependenciesCard machinesStore={systemDependenciesStore} />
    </div>
  );
}
