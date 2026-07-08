const LAST_PORT_KEY = 'tauri-monitor-last-port-v2';

export type TransportKind = 'serial' | 'ble';

export interface LastConnection {
  kind: TransportKind;
  value: string;
}

export function loadLastConnection(): LastConnection | null {
  try {
    const raw = localStorage.getItem(LAST_PORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if ((parsed.kind === 'serial' || parsed.kind === 'ble') && typeof parsed.value === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastConnection(connection: LastConnection) {
  try {
    localStorage.setItem(LAST_PORT_KEY, JSON.stringify(connection));
  } catch {
    // ignore - persistence is a nice-to-have, not required for the port to work
  }
}
