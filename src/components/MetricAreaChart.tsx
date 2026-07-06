import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface MetricAreaChartProps {
  data: { time: number; value: number }[];
  color: string;
  unit: string;
  label: string;
  valueFormatter?: (value: number) => string;
}

// Recharts calls this with the tight [min, max] of the data actually in
// view. Left alone, a signal that only wobbles by a fraction of a percent
// (typical ADC ripple on a cheap load) gets zoomed in until that ripple
// fills the whole chart height and reads as noise. Pad the range instead of
// hugging it.
function paddedDomain([dataMin, dataMax]: readonly [number, number]): [number, number] {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1];
  const span = dataMax - dataMin;
  const pad = Math.max(span * 0.2, Math.abs(dataMax) * 0.03, 0.01);
  return [dataMin - pad, dataMax + pad];
}

export default function MetricAreaChart({ data, color, unit, label, valueFormatter }: MetricAreaChartProps) {
  const gradientId = `chart-gradient-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const format = valueFormatter ?? ((v: number) => v.toFixed(2));

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <ResponsiveContainer width="100%" height="100%" minHeight={120}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="time" hide />
          <YAxis
            width={38}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            domain={paddedDomain}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={() => label}
            formatter={(value: unknown) => [format(Number(value)), unit] as [string, string]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
