// The Rust backend returns plain English error strings over IPC (see
// src-tauri/src/commands.rs) rather than error codes, so most of them can't
// be localized without a wider protocol change. This maps the fixed set of
// known messages to translation keys and falls back to the raw string for
// anything else (e.g. OS-level I/O errors), matching pre-i18n behavior.
import type { TFunction } from 'i18next';

const PORT_NOT_FOUND = /^Port not found: (.+)$/;
const FAILED_TO_OPEN_PORT = /^Failed to open port (.+)$/;

export function translateBackendError(t: TFunction, message: string | null | undefined): string | null | undefined {
  if (!message) return message;

  switch (message) {
    case 'No port selected':
      return t('errors.noPortSelected');
    case 'Probe failed':
      return t('errors.probeFailed');
    case 'Lost connection to device':
      return t('errors.lostConnection');
    case 'Not connected':
      return t('errors.notConnected');
    case 'Worker not running':
      return t('errors.workerNotRunning');
    case 'Device did not respond in time':
      return t('errors.deviceTimeout');
  }

  const portNotFound = message.match(PORT_NOT_FOUND);
  if (portNotFound) return t('errors.portNotFound', { port: portNotFound[1] });

  const failedToOpen = message.match(FAILED_TO_OPEN_PORT);
  if (failedToOpen) return t('errors.failedToOpenPort', { port: failedToOpen[1] });

  return message;
}
