import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const { t } = useTranslation();

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
    </div>
  );
}
