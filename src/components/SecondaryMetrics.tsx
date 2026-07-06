import type { DeviceMetrics } from '../types';

interface SecondaryMetricsProps {
  data: DeviceMetrics;
}

function formatNumber(value: number | string | null, decimals = 3): string {
  if (value == null) return '—';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isNaN(num) ? '—' : num.toFixed(decimals);
}

function formatRuntime(seconds: number | null): string {
  if (seconds == null) return '—';
  const s = Number(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

export default function SecondaryMetrics({ data }: SecondaryMetricsProps) {
  const items = [
    { label: 'Capacity', value: formatNumber(data.capacityMAh, 0), unit: 'mAh' },
    { label: 'Energy', value: formatNumber(data.energyWh, 2), unit: 'Wh' },
    { label: 'Temperature', value: formatNumber(data.tempC, 1), unit: '°C' },
    { label: 'Runtime', value: formatRuntime(data.runtimeS), unit: '' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(({ label, value, unit }) => (
        <div key={label} className="rounded-xl border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
            {value}
            {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
