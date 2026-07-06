const LAST_PORT_KEY = 'tauri-monitor-last-port-v1';

export function loadLastPort(): string | null {
  try {
    return localStorage.getItem(LAST_PORT_KEY);
  } catch {
    return null;
  }
}

export function saveLastPort(port: string) {
  try {
    localStorage.setItem(LAST_PORT_KEY, port);
  } catch {
    // ignore - persistence is a nice-to-have, not required for the port to work
  }
}
