import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatClockTime, paddedDomain } from '../utils/chartFormat';

interface CombinedMetricChartProps {
  data: { time: number; voltage: number; current: number; power: number }[];
  labels: { voltage: string; current: string; power: string };
}

const VOLTAGE_COLOR = '#818cf8';
const CURRENT_COLOR = '#34d399';
const POWER_COLOR = '#fbbf24';

// Voltage and current get their own visible axis (left/right) since those
// are the two series most worth reading exact tick values off of; power is
// plotted against a third, hidden axis - showing three tick columns at once
// reads as clutter, and power (= V x I) is already implied by the other two,
// with exact numbers still available via the tooltip and its own axis-less
// line in the legend.
export default function CombinedMetricChart({ data, labels }: CombinedMetricChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={120}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
          yAxisId="voltage"
          width={44}
          tick={{ fontSize: 11, fill: VOLTAGE_COLOR }}
          tickLine={false}
          axisLine={false}
          domain={paddedDomain}
          tickFormatter={(value: number) => value.toFixed(2)}
        />
        <YAxis
          yAxisId="current"
          orientation="right"
          width={44}
          tick={{ fontSize: 11, fill: CURRENT_COLOR }}
          tickLine={false}
          axisLine={false}
          domain={paddedDomain}
          tickFormatter={(value: number) => value.toFixed(3)}
        />
        {/* Orientation matters even though this axis is hidden - left is
            the default, and sharing it with the voltage axis (unlike the
            explicit "right" below) throws off recharts' reserved-width
            calculation for the visible left axis, pushing its tick labels
            to the wrong x position instead of just being invisible. */}
        <YAxis yAxisId="power" orientation="right" domain={paddedDomain} hide />
        <Tooltip
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(value: unknown) => formatClockTime(Number(value))}
          formatter={(value: unknown, name: unknown) => {
            const decimals = name === labels.current ? 3 : 2;
            return [Number(value).toFixed(decimals), name] as [string, string];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="voltage"
          type="monotone"
          dataKey="voltage"
          name={labels.voltage}
          stroke={VOLTAGE_COLOR}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
        <Line
          yAxisId="current"
          type="monotone"
          dataKey="current"
          name={labels.current}
          stroke={CURRENT_COLOR}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
        <Line
          yAxisId="power"
          type="monotone"
          dataKey="power"
          name={labels.power}
          stroke={POWER_COLOR}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
