import { Bluetooth, Cpu, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import type { ConnectionStatusEvent_Deserialize } from '../bindings';
import type { AppSettings } from '../types';
import SettingsPanel from './SettingsPanel';

type ConnectionStatus = Partial<ConnectionStatusEvent_Deserialize>;

interface StatusHeaderProps {
  ports: string[];
  selectedPort: string | null;
  onSelectPort: (port: string) => void;
  onRefresh: () => void;
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

function stageLabel(status: ConnectionStatus, selectedPort: string | null): string {
  if (status.stage === 'probing') {
    const port = selectedPort ? ` ${selectedPort}` : '';
    return `Probing${port} (${status.attempt ?? 0}/${status.maxAttempts ?? 0})`;
  }
  if (status.stage === 'connected') return 'Connected';
  if (status.stage === 'disconnected') return 'Disconnected';
  if (status.stage === 'validation') return 'Validation error';
  if (status.stage === 'probe_failed') return 'Probe failed';
  if (status.stage === 'error') return 'Connection error';
  return status.connected ? 'Connected' : 'Disconnected';
}

export default function StatusHeader(props: StatusHeaderProps) {
  const {
    ports,
    selectedPort,
    onSelectPort,
    onRefresh,
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

  const busy = isConnecting || isAutoDetecting;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg border bg-muted text-primary">
          <Cpu className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Atorch DL24</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-muted-foreground/50'}`} />
            <Bluetooth className="size-3" />
            <span>{isAutoDetecting ? `Detecting device… (${stageLabel(status, selectedPort)})` : stageLabel(status, selectedPort)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedPort ?? ''} onValueChange={onSelectPort} disabled={connected || busy}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="Select port" />
          </SelectTrigger>
          <SelectContent>
            {ports.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="icon" className="size-9" onClick={onRefresh} disabled={busy}>
          <RefreshCw className="size-4" />
        </Button>

        <Button
          variant={connected ? 'destructive' : 'default'}
          onClick={onConnectToggle}
          disabled={busy || (!selectedPort && !connected)}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {isAutoDetecting
            ? 'Detecting…'
            : isConnecting
              ? connected
                ? 'Disconnecting…'
                : 'Connecting…'
              : connected
                ? 'Disconnect'
                : 'Connect'}
        </Button>

        {status.error && !isAutoDetecting && <Badge variant="destructive">{status.error}</Badge>}

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="size-9">
              <Settings2 className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Settings</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="dark-mode">Dark theme</Label>
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
  );
}
