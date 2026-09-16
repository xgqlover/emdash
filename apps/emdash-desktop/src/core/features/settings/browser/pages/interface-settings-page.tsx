import { t } from '@renderer/lib/i18n';
import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import FilesSettingsCard from '../components/FilesSettingsCard';
import HiddenToolsSettingsCard from '../components/HiddenToolsSettingsCard';
import InterfaceSettingsCard from '../components/InterfaceSettingsCard';
import KeyboardSettingsCard from '../components/KeyboardSettingsCard';
import SidebarMetadataSettingsCard from '../components/SidebarMetadataSettingsCard';
import TerminalSettingsCard from '../components/TerminalSettingsCard';
import ThemeCard from '../components/ThemeCard';

export function InterfaceSettingsPage() {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title={t('interface')}
        description={t('interface_desc')}
      />
      <SettingsSection title={t('color_mode')} bare>
        <ThemeCard />
      </SettingsSection>
      <SettingsSection title={t('terminal')} bare>
        <TerminalSettingsCard />
      </SettingsSection>
      <SettingsSection title={t('files')} bare>
        <FilesSettingsCard />
      </SettingsSection>
      <SettingsSection title={t('sidebar')} bare>
        <SidebarMetadataSettingsCard />
      </SettingsSection>
      <SettingsSection bare>
        <InterfaceSettingsCard />
      </SettingsSection>
      <SettingsSection title={t('keyboard_shortcuts')} bare>
        <KeyboardSettingsCard />
      </SettingsSection>
      <SettingsSection title={t('tools')} bare>
        <HiddenToolsSettingsCard />
      </SettingsSection>
    </div>
  );
}
