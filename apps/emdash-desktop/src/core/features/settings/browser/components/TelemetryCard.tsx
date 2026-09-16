import { t } from '@renderer/lib/i18n';
import { Button, Switch } from '@emdash/ui/react/primitives';
import { ArrowUpRight } from 'lucide-react';
import React from 'react';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { captureTelemetry } from '@core/primitives/telemetry/browser/telemetry-client';
import { useTelemetryConsent } from '@core/primitives/telemetry/browser/useTelemetryConsent';
import { SettingRow } from './SettingRow';

const TelemetryCard: React.FC = () => {
  const { prefEnabled, envDisabled, hasKeyAndHost, loading, setTelemetryEnabled } =
    useTelemetryConsent();

  return (
    <SettingRow
      title={t('privacy_telemetry')}
      description={
        <div>
          <p>{t('telemetry_desc')}</p>
          <p>
            <span>See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group text-muted-foreground inline-flex h-auto items-center gap-1 px-0 text-sm font-normal hover:text-foreground hover:no-underline focus-visible:ring-0 focus-visible:outline-none"
              onClick={() => openExternal('https://docs.emdash.sh/telemetry')}
            >
              <span className="transition-colors group-hover:text-foreground">
                {t('telemetry_info')}
              </span>
              <ArrowUpRight className="text-muted-foreground size-3.5 transition-colors transition-transform duration-200 group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-foreground" />
            </Button>
            <span>{t('for_details')}</span>
          </p>
        </div>
      }
      control={
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={prefEnabled}
            onCheckedChange={(checked) => {
              captureTelemetry('setting_changed', { setting: 'telemetry' });
              void setTelemetryEnabled(checked);
            }}
            disabled={loading || envDisabled}
            aria-label="Enable anonymous telemetry"
          />
          {!hasKeyAndHost && (
            <span className="text-muted-foreground text-[10px]">
              {t('telemetry_inactive')}
            </span>
          )}
        </div>
      }
    />
  );
};

export default TelemetryCard;
