// [XG-CUSTOM 2026-10-16] 历史欠账补标：本文件含 fork 定制（中文化/界面适配） —— 台账见 scripts/xg-custom/manifest.json
import { t } from '@renderer/lib/i18n';
import { SelectableCard } from '@emdash/ui/react/primitives';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import React from 'react';
import type { Theme } from '@core/primitives/app-settings/api';
import { captureTelemetry } from '@core/primitives/telemetry/browser/telemetry-client';
import { useTheme } from '@core/primitives/theme/browser';

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();

// [XG-CUSTOM 2026-10-16] fork 定制（中文化/界面适配）；台账见 scripts/xg-custom/manifest.json
  const themeOptions: Array<{
    value: Theme;
    label: string;
    ariaLabel: string;
    icon: LucideIcon;
  }> = [
    { value: null, label: t('system'), ariaLabel: t('set_theme_system'), icon: Monitor },
    { value: 'emlight', label: t('emdash_light'), ariaLabel: t('set_theme_light'), icon: Sun },
    { value: 'emdark', label: t('emdash_dark'), ariaLabel: t('set_theme_dark'), icon: Moon },
  ];

  const handleSetTheme = (next: Theme) => {
    if (theme !== next) {
      captureTelemetry('setting_changed', { setting: 'theme' });
    }
    setTheme(next);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2 text-sm">
      {themeOptions.map(({ value, label, ariaLabel, icon: Icon }) => (
        <SelectableCard
          key={label}
          selected={theme === value}
          onClick={() => handleSetTheme(value)}
          aria-label={ariaLabel}
          aria-pressed={theme === value}
          className="min-h-24"
        >
          <span className="flex flex-col items-center justify-center gap-2 px-2 py-2.5 text-sm font-medium sm:px-3">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-center">{label}</span>
          </span>
        </SelectableCard>
      ))}
    </div>
  );
};

export default ThemeCard;
