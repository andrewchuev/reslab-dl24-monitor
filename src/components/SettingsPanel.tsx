import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { AppSettings } from '../types';
import BleTestPanel from './BleTestPanel';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const { t } = useTranslation();

  // New readings arrive once per poll cycle, so the throttle can only ever
  // skip whole cycles - it rounds up to the next multiple of the poll
  // interval rather than smoothly scaling with its own slider value. Showing
  // that resulting cadence directly (instead of an "active"/"inactive" label)
  // avoids implying a gradual effect where the real one is a step function.
  const effectiveRefreshMs = Math.ceil(settings.chartRefreshMs / settings.pollIntervalMs) * settings.pollIntervalMs;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>{t('settingsPanel.pollInterval', { value: settings.pollIntervalMs })}</Label>
        <Slider
          value={[settings.pollIntervalMs]}
          min={300}
          max={10000}
          step={100}
          onValueChange={([value]) => onChange({ ...settings, pollIntervalMs: value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t('settingsPanel.chartRefresh', { value: settings.chartRefreshMs })}</Label>
        <p className="text-xs text-muted-foreground">
          {t('settingsPanel.chartRefreshHint', { value: effectiveRefreshMs })}
        </p>
        <Slider
          value={[settings.chartRefreshMs]}
          min={100}
          max={5000}
          step={50}
          onValueChange={([value]) => onChange({ ...settings, chartRefreshMs: value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>{t('settingsPanel.maxPoints', { value: settings.maxPoints })}</Label>
        <p className="text-xs text-muted-foreground">{t('settingsPanel.maxPointsHint')}</p>
        <Slider
          value={[settings.maxPoints]}
          min={50}
          max={5000}
          step={50}
          onValueChange={([value]) => onChange({ ...settings, maxPoints: value })}
        />
      </div>

      <BleTestPanel />
    </div>
  );
}
