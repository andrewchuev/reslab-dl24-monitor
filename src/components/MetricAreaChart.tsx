import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface MetricAreaChartProps {
  data: { time: number; value: number }[];
  color: string;
  unit: string;
  // Stable, language-independent identifier for the gradient's DOM id.
  id: string;
  label: string;
  valueFormatter?: (value: number) => string;
}

// Recharts calls this with the tight [min, max] of the data actually in
// view. Left alone, a signal that only wobbles by a fraction of a percent
// (typical ADC ripple on a cheap load) gets zoomed in until that ripple
// fills the whole chart height and reads as noise. Pad the range instead of
// hugging it.
// Formats an epoch-ms sample time as local hh:mm:ss - used for both the
// X-axis ticks and the tooltip header, so hovering a point (or reading the
// axis) shows the actual time the reading was taken, not time elapsed since
// the session started.
function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function paddedDomain([dataMin, dataMax]: readonly [number, number]): [number, number] {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return [0, 1];
  const span = dataMax - dataMin;
  const pad = Math.max(span * 0.2, Math.abs(dataMax) * 0.03, 0.01);
  // Rounded to kill floating-point noise (e.g. 19.7 - 0.03 = 19.669999999999998):
  // Recharts doesn't "nice"-round a domain that comes from a function, so
  // without this the raw un-rounded endpoint can end up as a tick label -
  // and with the axis label column only ~38px wide, only the tail digits of
  // a 17-character float end up visible, reading as unrelated garbage.
  return [Number((dataMin - pad).toFixed(6)), Number((dataMax + pad).toFixed(6))];
}

export default function MetricAreaChart({ data, color, unit, id, label, valueFormatter }: MetricAreaChartProps) {
  const gradientId = `chart-gradient-${id}`;
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
