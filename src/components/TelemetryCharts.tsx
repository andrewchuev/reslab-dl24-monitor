import { useMemo, useState } from 'react';
import { Download, Pause, Play, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CombinedMetricChart from './CombinedMetricChart';
import MetricAreaChart from './MetricAreaChart';
import type { TimeRange } from '../types';

type ChartViewMode = 'separate' | 'combined';

interface TelemetryChartsProps {
  hasData: boolean;
  // Epoch ms (Date.now()) per sample - real time, not elapsed-since-start.
  times: number[];
  voltage: number[];
  current: number[];
  power: number[];
  timeRange: TimeRange;
  onTimeRangeChange: (value: TimeRange) => void;
  // Caps how many points get drawn per chart, independent of how much
  // history is retained (that's unbounded - see Dashboard's chartDataRef).
  // Without this, selecting "All" on an hours-long session would hand
  // recharts tens of thousands of SVG points.
  maxRenderPoints: number;
  isPaused: boolean;
  onPauseResume: () => void;
  onReset: () => void;
  onExportCsv: () => void;
  onExportXlsx: () => void;
}

function rangeSeconds(range: TimeRange): number {
  if (range === '30s') return 30;
  if (range === '5m') return 300;
  if (range === '15m') return 900;
  return Number.POSITIVE_INFINITY;
}

// Downsamples to at most maxPoints by taking every Nth point, always keeping
// the most recent one so the chart's right edge matches the latest reading.
function decimate<T>(data: T[], maxPoints: number): T[] {
  if (data.length <= maxPoints) return data;
  const stride = Math.ceil(data.length / maxPoints);
  const result: T[] = [];
  for (let i = 0; i < data.length; i += stride) {
    result.push(data[i]);
  }
  const last = data[data.length - 1];
  if (result[result.length - 1] !== last) result.push(last);
  return result;
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
    maxRenderPoints,
    isPaused,
    onPauseResume,
    onReset,
    onExportCsv,
    onExportXlsx,
  } = props;

  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ChartViewMode>('separate');
  const cutoffSec = rangeSeconds(timeRange);
  const last = times.length ? times[times.length - 1] : 0;
  const startWindow = last - cutoffSec * 1000;
  const fromIdx =
    cutoffSec === Number.POSITIVE_INFINITY ? 0 : Math.max(0, times.findIndex((t) => t >= startWindow));

  const voltageData = useMemo(
    () => decimate(smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: voltage[fromIdx + i] }))), maxRenderPoints),
    [times, voltage, fromIdx, maxRenderPoints]
  );
  const currentData = useMemo(
    () => decimate(smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: current[fromIdx + i] }))), maxRenderPoints),
    [times, current, fromIdx, maxRenderPoints]
  );
  const powerData = useMemo(
    () => decimate(smooth(times.slice(fromIdx).map((t, i) => ({ time: t, value: power[fromIdx + i] }))), maxRenderPoints),
    [times, power, fromIdx, maxRenderPoints]
  );

  // voltageData/currentData/powerData all decimate the same-length, same-
  // time-base slice with the same stride, so they land on identical indices
  // and times - safe to zip by position into one dataset for the combined
  // view.
  const combinedData = useMemo(
    () =>
      voltageData.map((d, i) => ({
        time: d.time,
        voltage: d.value,
        current: currentData[i]?.value ?? 0,
        power: powerData[i]?.value ?? 0,
      })),
    [voltageData, currentData, powerData]
  );

  return (
    <div className="flex h-full flex-col rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{t('telemetry.heading')}</h2>
          <Badge variant={isPaused ? 'secondary' : 'default'}>
            {/* "Live" stays in English in every language - it's a
                near-universal streaming/dashboard term (Live/Paused),
                and translating it risks colliding in meaning with the
                separate "device connected" indicator. */}
            {isPaused ? t('telemetry.paused') : 'Live'}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border p-0.5">
            <Button
              variant={viewMode === 'separate' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setViewMode('separate')}
            >
              {t('telemetry.viewSeparate')}
            </Button>
            <Button
              variant={viewMode === 'combined' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8"
              onClick={() => setViewMode('combined')}
            >
              {t('telemetry.viewCombined')}
            </Button>
          </div>
          <Select value={timeRange} onValueChange={(v) => onTimeRangeChange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30s">30s</SelectItem>
              <SelectItem value="5m">5m</SelectItem>
              <SelectItem value="15m">15m</SelectItem>
              <SelectItem value="all">{t('telemetry.rangeAll')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="size-11" onClick={onPauseResume}>
            {isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Button>
          <Button variant="outline" size="icon" className="size-11" onClick={onReset}>
            <RotateCcw className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onExportCsv} disabled={!hasData}>
            <Download className="size-4" />
            {t('telemetry.exportCsv')}
          </Button>
          <Button variant="outline" size="sm" onClick={onExportXlsx} disabled={!hasData}>
            <Download className="size-4" />
            {t('telemetry.exportXlsx')}
          </Button>
        </div>
      </div>

      {hasData ? (
        viewMode === 'combined' ? (
          <div className="min-h-[220px] flex-1 p-4">
            <CombinedMetricChart
              data={combinedData}
              labels={{ voltage: t('metrics.voltage'), current: t('metrics.current'), power: t('metrics.power') }}
            />
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3">
            <div className="h-full min-h-[220px]">
              <MetricAreaChart
                data={voltageData}
                color="#818cf8"
                unit="V"
                id="voltage"
                label={t('metrics.voltage')}
                syncId="telemetry"
              />
            </div>
            <div className="h-full min-h-[220px]">
              <MetricAreaChart
                data={currentData}
                color="#34d399"
                unit="A"
                id="current"
                label={t('metrics.current')}
                valueFormatter={(v) => v.toFixed(3)}
                syncId="telemetry"
              />
            </div>
            <div className="h-full min-h-[220px]">
              <MetricAreaChart
                data={powerData}
                color="#fbbf24"
                unit="W"
                id="power"
                label={t('metrics.power')}
                syncId="telemetry"
              />
            </div>
          </div>
        )
      ) : (
        <div className="flex min-h-[220px] flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('telemetry.emptyState')}
        </div>
      )}
    </div>
  );
}
