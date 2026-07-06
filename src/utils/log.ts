import { info, warn, error as logErrorPlugin } from '@tauri-apps/plugin-log';

// Forwards to the Rust-side logger (tauri-plugin-log), landing in the same
// per-session log file as the backend's telemetry/serial logs - so a user
// action and its effect on the device show up interleaved in one place.

function withData(message: string, data?: object): string {
  return data ? `${message} ${JSON.stringify(data)}` : message;
}

export function logAction(message: string, data?: object) {
  void info(withData(`[action] ${message}`, data));
}

export function logInfo(message: string, data?: object) {
  void info(withData(message, data));
}

export function logWarn(message: string, data?: object) {
  void warn(withData(message, data));
}

export function logError(message: string, data?: object) {
  void logErrorPlugin(withData(message, data));
}
