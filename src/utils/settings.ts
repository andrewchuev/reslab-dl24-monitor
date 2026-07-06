import type { AppSettings } from '../types';

const SETTINGS_KEY = 'tauri-monitor-settings-v1';

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalMs: 1500,
  chartRefreshMs: 600,
  maxPoints: 400,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      pollIntervalMs: clampNum(parsed.pollIntervalMs, 300, 10000, DEFAULT_SETTINGS.pollIntervalMs),
      chartRefreshMs: clampNum(parsed.chartRefreshMs, 100, 5000, DEFAULT_SETTINGS.chartRefreshMs),
      maxPoints: clampNum(parsed.maxPoints, 50, 5000, DEFAULT_SETTINGS.maxPoints),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

