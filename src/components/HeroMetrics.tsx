import { Gauge, Flame, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DeviceMetrics } from '../types';

interface HeroMetricsProps {
  data: DeviceMetrics;
}

function formatNumber(value: number | null, decimals = 3): string {
  return value == null || Number.isNaN(value) ? '—' : value.toFixed(decimals);
}

export default function HeroMetrics({ data }: HeroMetricsProps) {
  const { t } = useTranslation();
  const items = [
    { label: t('metrics.voltage'), value: formatNumber(data.voltageV, 2), unit: 'V', icon: Zap, color: 'text-indigo-400' },
    { label: t('metrics.current'), value: formatNumber(data.currentA, 3), unit: 'A', icon: Gauge, color: 'text-emerald-400' },
    { label: t('metrics.power'), value: formatNumber(data.powerW, 2), unit: 'W', icon: Flame, color: 'text-amber-400' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {items.map(({ label, value, unit, icon: Icon, color }) => (
        <div key={label} className="flex items-center justify-between rounded-xl border bg-card px-5 py-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">
              {value}
              <span className="ml-1 text-base text-muted-foreground">{unit}</span>
            </div>
          </div>
          <Icon className={`size-8 ${color}`} strokeWidth={1.5} />
        </div>
      ))}
    </div>
  );
}
