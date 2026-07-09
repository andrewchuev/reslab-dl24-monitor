// Shared formatting helpers for recharts-based telemetry charts (both the
// per-metric grid and the combined multi-axis chart).

// Formats an epoch-ms sample time as local hh:mm:ss - used for both the
// X-axis ticks and the tooltip header, so hovering a point (or reading the
// axis) shows the actual time the reading was taken, not time elapsed since
// the session started.
export function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Recharts calls this with the tight [min, max] of the data actually in
// view. Left alone, a signal that only wobbles by a fraction of a percent
// (typical ADC ripple on a cheap load) gets zoomed in until that ripple
// fills the whole chart height and reads as noise. Pad the range instead of
// hugging it.
export function paddedDomain([dataMin, dataMax]: readonly [number, number]): [number, number] {
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
