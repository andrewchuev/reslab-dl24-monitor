import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { commands, type BleDeviceInfo } from '../bindings';
import { logAction, logError } from '../utils/log';

/**
 * Temporary verification spike for the BLE-vs-SPP investigation - not part
 * of the app's normal connect flow. Scans for the device over BLE and probes
 * whether B1B2 *write* commands (not just the already-confirmed read-only
 * FF55 telemetry broadcast) work when tunneled through the FFE1
 * characteristic. Remove once that question is answered.
 */
export default function BleTestPanel() {
  const [devices, setDevices] = useState<BleDeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [probing, setProbing] = useState<string | null>(null);
  const [result, setResult] = useState<string[] | null>(null);

  const scan = async () => {
    setScanning(true);
    setResult(null);
    logAction('ble_test.scan');
    try {
      const res = await commands.bleScan();
      if (res.status === 'error') {
        logError('ble_test.scan failed', { error: res.error });
        toast.error(res.error);
      } else {
        setDevices(res.data);
        toast.success(`Found ${res.data.length} device(s)`);
      }
    } catch (err) {
      logError('ble_test.scan threw', { error: String(err) });
      toast.error(String(err));
    } finally {
      setScanning(false);
    }
  };

  const probe = async (address: string) => {
    setProbing(address);
    setResult(null);
    logAction('ble_test.probe', { address });
    try {
      const res = await commands.bleProbe(address);
      if (res.status === 'error') {
        logError('ble_test.probe failed', { error: res.error });
        toast.error(res.error);
      } else {
        setResult(res.data);
        toast.success(`Got ${res.data.length} notification(s)`);
      }
    } catch (err) {
      logError('ble_test.probe threw', { error: String(err) });
      toast.error(String(err));
    } finally {
      setProbing(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-amber-500/50 p-4">
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        BLE test (dev only) — scans for the device and checks whether B1B2 write commands (e.g. reset
        counters) work over BLE, not just read-only telemetry.
      </p>

      <Button size="sm" variant="outline" disabled={scanning} onClick={scan}>
        {scanning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Scan BLE devices
      </Button>

      {devices.length > 0 && (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li key={d.address} className="flex items-center justify-between gap-2 text-xs">
              <span>
                {d.name || '(unnamed)'} — {d.address}
                {d.rssi != null && ` (${d.rssi} dBm)`}
              </span>
              <Button size="sm" variant="secondary" disabled={probing !== null} onClick={() => probe(d.address)}>
                {probing === d.address && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Probe (query + reset)
              </Button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <pre className="whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">
          {result.length === 0 ? '(no notifications received)' : result.join('\n')}
        </pre>
      )}
    </div>
  );
}
