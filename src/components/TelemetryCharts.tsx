import { useMemo } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import MetricAreaChart from './MetricAreaChart';
import type { TimeRange } from '../types';

interface TelemetryChartsProps {
  hasData: boolean;
  times: number[];
  voltage: number[];
  current: number[];
  power: number[];
  timeRange: TimeRange;
  onTimeRangeChange: (value: TimeRange) => void;
  isPaused: boolean;
  onPauseResume: () => void;
  onReset: () => void;
  onExportCsv: () => void;
}

function rangeSeconds(range: TimeRange): number {
  if (range === '30s') return 30;
  if (range === '5m') return 300;
  if (range === '15m') return 900;
  return Number.POSITIVE_INFINITY;
}

// Exponential moving average, applied for display only - the raw samples
// still go into CSV export untouched. A cheap electronic load's current/
// voltage sense has real ADC ripple that reads as illegible sawtooth noise
// once the chart's Y-axis zooms in on it; this smooths the trend without
// hiding genuine step changes (alpha=0.25 settles in ~4-5 samples).
function smooth(data: { time: number; value: number }[], alpha = 0.25) {
  if (data.length === 0) return data;
  const result = new Array<{ time: number; value: number }>(data.length);
  let ema = data[0].value;
  result[0] = { time: data[0].time, value: ema };
  for (let i = 1; i < data.length; i += 1) {
    ema = alpha * data[i].value + (1 - alpha) * ema;
    result[i] = { time: data[i].time, value: ema };
  }
  return result;
}

export default function TelemetryCharts(props: TelemetryChartsProps) {
  const {
    hasData,
    times,
    voltage,
    current,
    power,
    timeRange,
    onTimeRangeChange,
    isPaused,
    onPauseResume,
    onReset,
    onExportCsv,
  } = props;

  const cutoffSec = rangeSeconds(timeRange);
  const last = times.length ? times[times.length - 1] : 0;
  const startWindow = last - cutoffSec;
  const fromIdx =
    cutoffSec === Number.POSITIVE_INFINITY ? 0 : Math.max(0, times.findIndex((t) => t >= startWindow));

  const voltageData = useMemo(
    () => smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: voltage[fromIdx + i] }))),
    [times, voltage, fromIdx]
  );
  const currentData = useMemo(
    () => smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: current[fromIdx + i] }))),
    [times, current, fromIdx]
  );
  const powerData = useMemo(
    () => smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: power[fromIdx + i] }))),
    [times, power, fromIdx]
  );

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Real-time Telemetry</h2>
          <Badge variant={isPaused ? 'secondary' : 'default'}>{isPaused ? 'Paused' : 'Live'}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={timeRange} onValueChange={(v) => onTimeRangeChange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30s">30s</SelectItem>
              <SelectItem value="5m">5m</SelectItem>
              <SelectItem value="15m">15m</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="size-8" onClick={onPauseResume}>
            {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Button>
          <Button variant="outline" size="icon" className="size-8" onClick={onReset}>
            <RotateCcw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onExportCsv} disabled={!hasData}>
            <Download className="size-4" />
            Export
          </Button>
        </div>
      </div>

      {hasData ? (
        <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-3">
          <div className="h-[220px]">
            <MetricAreaChart data={voltageData} color="#818cf8" unit="V" label="Voltage" />
          </div>
          <div className="h-[220px]">
            <MetricAreaChart
              data={currentData}
              color="#34d399"
              unit="A"
              label="Current"
              valueFormatter={(v) => v.toFixed(3)}
            />
          </div>
          <div className="h-[220px]">
            <MetricAreaChart data={powerData} color="#fbbf24" unit="W" label="Power" />
          </div>
        </div>
      ) : (
        <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
          Connect to the device to start monitoring
        </div>
      )}
    </div>
  );
}
