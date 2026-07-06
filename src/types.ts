// Device metrics displayed in the UI before the first device-data event arrives
// (all fields unknown yet, unlike the always-populated DeviceDataEvent from bindings.ts).
export interface DeviceMetrics {
  voltageV: number | null;
  currentA: number | null;
  capacityMAh: number | null;
  powerW: string | number | null;
  tempC: number | null;
  runtimeS: number | null;
  energyWh: number | null;
  isOn: boolean | null;
  setCurrentA: number | null;
  setCutoffV: number | null;
  setTimerS: number | null;
}

export interface AppSettings {
  pollIntervalMs: number;
  chartRefreshMs: number;
  maxPoints: number;
}

export type TimeRange = '30s' | '5m' | '15m' | 'all';

