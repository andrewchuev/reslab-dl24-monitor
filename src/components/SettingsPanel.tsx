import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}

export default function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>Poll interval: {settings.pollIntervalMs} ms</Label>
        <Slider
          value={[settings.pollIntervalMs]}
          min={300}
          max={10000}
          step={100}
          onValueChange={([value]) => onChange({ ...settings, pollIntervalMs: value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Chart refresh throttle: {settings.chartRefreshMs} ms</Label>
        <Slider
          value={[settings.chartRefreshMs]}
          min={100}
          max={5000}
          step={50}
          onValueChange={([value]) => onChange({ ...settings, chartRefreshMs: value })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Max chart points: {settings.maxPoints}</Label>
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
