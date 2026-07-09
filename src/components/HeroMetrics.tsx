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
    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {items.map(({ label, value, unit, icon: Icon, color }) => (
        <div
          key={label}
          className="flex items-center justify-between gap-1 rounded-xl border bg-card px-2 py-2.5 sm:px-5 sm:py-4"
        >
          <div className="min-w-0">
            <div className="truncate text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
              {label}
            </div>
            {/* Unit stays glued to the number (no truncating it away) - the
                icon is the one thing that can afford to disappear below
                `sm`, since three columns at phone width don't leave enough
                room for icon + full label + full reading all at once. */}
            <div className="mt-1 whitespace-nowrap font-mono text-base font-semibold tabular-nums sm:text-3xl">
              {value}
              <span className="ml-1 text-[0.65rem] text-muted-foreground sm:text-base">{unit}</span>
            </div>
          </div>
          <Icon className={`hidden size-8 shrink-0 sm:block ${color}`} strokeWidth={1.5} />
        </div>
      ))}
    </div>
  );
}
