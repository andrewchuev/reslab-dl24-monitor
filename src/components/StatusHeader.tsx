import { Bluetooth, Cpu, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import type { TFunction } from 'i18next';
import type { BleDeviceInfo, ConnectionStatusEvent_Deserialize } from '../bindings';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';
import type { AppSettings } from '../types';
import { translateBackendError } from '../utils/backendErrors';
import type { TransportKind } from '../utils/lastPort';
import SettingsPanel from './SettingsPanel';

type ConnectionStatus = Partial<ConnectionStatusEvent_Deserialize>;

interface StatusHeaderProps {
  isMobile: boolean;
  transport: TransportKind;
  onTransportChange: (transport: TransportKind) => void;
  ports: string[];
  selectedPort: string | null;
  onSelectPort: (port: string) => void;
  onRefresh: () => void;
  bleDevices: BleDeviceInfo[];
  selectedBleAddress: string | null;
  onSelectBleAddress: (address: string) => void;
  onScanBle: () => void;
  bleScanning: boolean;
  onConnectToggle: () => void;
  connected: boolean;
  isConnecting: boolean;
  isAutoDetecting: boolean;
  themeMode: 'light' | 'dark';
  setThemeMode: (mode: 'light' | 'dark') => void;
  status: ConnectionStatus;
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
}

function bleDeviceLabel(d: BleDeviceInfo): string {
  const name = d.name || d.address;
  return d.rssi != null ? `${name} (${d.rssi} dBm)` : name;
}

const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  ru: 'Русский',
  uk: 'Українська',
};

function stageLabel(t: TFunction, status: ConnectionStatus, selectedPort: string | null): string {
  if (status.stage === 'connecting') return t('status.connectingStage');
  if (status.stage === 'probing') {
    const attempt = status.attempt ?? 0;
    const maxAttempts = status.maxAttempts ?? 0;
    return selectedPort
      ? t('status.probingPort', { port: selectedPort, attempt, maxAttempts })
      : t('status.probing', { attempt, maxAttempts });
  }
  if (status.stage === 'connected') return t('status.connected');
  if (status.stage === 'disconnected') return t('status.disconnected');
  if (status.stage === 'validation') return t('status.validationError');
  if (status.stage === 'probe_failed') return t('status.probeFailed');
  if (status.stage === 'reconnecting') {
    return t('status.reconnecting', { attempt: status.attempt ?? 0, maxAttempts: status.maxAttempts ?? 0 });
  }
  if (status.stage === 'error') return t('status.connectionError');
  return status.connected ? t('status.connected') : t('status.disconnected');
}

export default function StatusHeader(props: StatusHeaderProps) {
  const {
    isMobile,
    transport,
    onTransportChange,
    ports,
    selectedPort,
    onSelectPort,
    onRefresh,
    bleDevices,
    selectedBleAddress,
    onSelectBleAddress,
    onScanBle,
    bleScanning,
    onConnectToggle,
    connected,
    isConnecting,
    isAutoDetecting,
    themeMode,
    setThemeMode,
    status,
    settings,
    onSettingsChange,
  } = props;

  const { t, i18n } = useTranslation();
  const busy = isConnecting || isAutoDetecting;
  const displayedError = translateBackendError(t, status.error);
  const hasSelection = transport === 'serial' ? Boolean(selectedPort) : Boolean(selectedBleAddress);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg border bg-muted text-primary">
          <Cpu className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Atorch DL24</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} />
            <Bluetooth className="size-3" />
            <span>
              {isAutoDetecting
                ? t('status.detecting', { stage: stageLabel(t, status, selectedPort) })
                : stageLabel(t, status, selectedPort)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Serial has no meaning on mobile (no COM ports) - not just
              de-prioritized, not offered at all. */}
          {!isMobile && (
            <div className="flex items-center rounded-md border p-0.5">
              <Button
                variant={transport === 'serial' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-9"
                disabled={connected || busy}
                onClick={() => onTransportChange('serial')}
              >
                {t('status.transportSerial')}
              </Button>
              <Button
                variant={transport === 'ble' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-9"
                disabled={connected || busy}
                onClick={() => onTransportChange('ble')}
              >
                {t('status.transportBle')}
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
          {transport === 'serial' ? (
            <Select value={selectedPort ?? ''} onValueChange={onSelectPort} disabled={connected || busy}>
              <SelectTrigger className="h-9 min-w-0 flex-1 sm:w-[150px] sm:flex-none">
                <SelectValue placeholder={t('status.selectPort')} />
              </SelectTrigger>
              <SelectContent>
                {ports.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={selectedBleAddress ?? ''} onValueChange={onSelectBleAddress} disabled={connected || busy}>
              <SelectTrigger className="h-9 min-w-0 flex-1 sm:w-[200px] sm:flex-none">
                <SelectValue placeholder={t('status.selectDevice')} />
              </SelectTrigger>
              <SelectContent>
                {bleDevices.map((d) => (
                  <SelectItem key={d.address} value={d.address}>
                    {bleDeviceLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            onClick={transport === 'serial' ? onRefresh : onScanBle}
            disabled={busy || bleScanning}
          >
            {transport === 'ble' && bleScanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={connected ? 'destructive' : 'default'}
            className="flex-1 sm:flex-none"
            onClick={onConnectToggle}
            disabled={busy || (!hasSelection && !connected)}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {isAutoDetecting
              ? t('status.detectingButton')
              : status.stage === 'reconnecting'
                ? t('status.reconnectingButton')
                : isConnecting
                  ? connected
                    ? t('status.disconnectingButton')
                    : t('status.connectingButton')
                  : connected
                    ? t('status.disconnectButton')
                    : t('status.connectButton')}
          </Button>

          {displayedError && !isAutoDetecting && <Badge variant="destructive">{displayedError}</Badge>}

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="size-11 shrink-0">
                <Settings2 className="size-4" />
              </Button>
            </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('app.settings')}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="language-select">{t('app.language')}</Label>
                <Select value={i18n.resolvedLanguage ?? 'en'} onValueChange={(lng) => i18n.changeLanguage(lng)}>
                  <SelectTrigger id="language-select" className="h-8 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map((lng) => (
                      <SelectItem key={lng} value={lng}>
                        {LANGUAGE_NAMES[lng]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="dark-mode">{t('app.darkTheme')}</Label>
                <Switch
                  id="dark-mode"
                  checked={themeMode === 'dark'}
                  onCheckedChange={(checked) => setThemeMode(checked ? 'dark' : 'light')}
                />
              </div>
              <SettingsPanel settings={settings} onChange={onSettingsChange} />
            </div>
          </SheetContent>
        </Sheet>
        </div>
      </div>
    </div>
  );
}
