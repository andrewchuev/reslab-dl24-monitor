import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatClockTime, paddedDomain } from '../utils/chartFormat';

interface MetricAreaChartProps {
  data: { time: number; value: number }[];
  color: string;
  unit: string;
  // Stable, language-independent identifier for the gradient's DOM id.
  id: string;
  label: string;
  valueFormatter?: (value: number) => string;
  // Shared across the V/A/W charts so tapping (or hovering) any one of them
  // shows the cursor/tooltip at the same instant on all three - without
  // this, touch input leaves each chart's tooltip stuck open independently
  // (touch has no mouseleave to clear it), which reads as three unrelated
  // glitches instead of one coherent instrument-panel reading.
  syncId?: string;
}

export default function MetricAreaChart({ data, color, unit, id, label, valueFormatter, syncId }: MetricAreaChartProps) {
  const gradientId = `chart-gradient-${id}`;
  const format = valueFormatter ?? ((v: number) => v.toFixed(2));

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      <ResponsiveContainer width="100%" height="100%" minHeight={120}>
        <AreaChart data={data} syncId={syncId} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(value: number) => formatClockTime(value)}
          />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            domain={paddedDomain}
            tickFormatter={(value: number) => format(value)}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(value: unknown) => `${label} @ ${formatClockTime(Number(value))}`}
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
