import { useState } from 'react';
import { Loader2, Power, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { commands } from '../bindings';
import type { DeviceMetrics } from '../types';

interface ControlCenterProps {
  connected: boolean;
  data: DeviceMetrics;
}

type CommandResult = Awaited<ReturnType<typeof commands.resetCounters>>;

async function runCommand(action: () => Promise<CommandResult>, successMessage: string) {
  try {
    const result = await action();
    if (result.status === 'error') {
      toast.error(result.error);
    } else {
      toast.success(successMessage);
    }
  } catch (err) {
    toast.error(String(err));
  }
}

type PendingAction = 'toggle' | 'current' | 'cutoff' | 'timeout' | 'reset' | null;

export default function ControlCenter({ connected, data }: ControlCenterProps) {
  const [currentInput, setCurrentInput] = useState('');
  const [cutoffInput, setCutoffInput] = useState('');
  const [timeoutInput, setTimeoutInput] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const disabled = !connected || pendingAction !== null;

  async function withPending(action: PendingAction, fn: () => Promise<void>) {
    setPendingAction(action);
    try {
      await fn();
    } finally {
      setPendingAction(null);
    }
  }

  const handleToggleLoad = () =>
    withPending('toggle', () =>
      runCommand(() => commands.setLoadOn(!data.isOn), data.isOn ? 'Load switched off' : 'Load switched on')
    );

  const handleSetCurrent = () => {
    const amps = parseFloat(currentInput);
    if (Number.isNaN(amps)) return;
    withPending('current', () =>
      runCommand(() => commands.setCurrent(amps), `Current set to ${amps.toFixed(2)} A`)
    );
  };

  const handleSetCutoff = () => {
    const volts = parseFloat(cutoffInput);
    if (Number.isNaN(volts)) return;
    withPending('cutoff', () =>
      runCommand(() => commands.setCutoffVoltage(volts), `Cut-off set to ${volts.toFixed(2)} V`)
    );
  };

  const handleSetTimeout = () => {
    const minutes = parseFloat(timeoutInput);
    if (Number.isNaN(minutes)) return;
    withPending('timeout', () =>
      runCommand(() => commands.setTimeoutSeconds(Math.round(minutes * 60)), `Timeout set to ${minutes} min`)
    );
  };

  const handleReset = () =>
    withPending('reset', () => runCommand(() => commands.resetCounters(), 'Counters reset'));

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Control Center</h2>
        {/* PX-100 only supports fixed constant-current mode: no mode-switch
            command exists in the protocol, so this is a label, not a selector. */}
        <Badge variant="outline">Mode: CC (fixed)</Badge>
      </div>

      <div className="flex flex-col gap-5">
        <Button
          size="lg"
          className="w-full"
          variant={data.isOn ? 'destructive' : 'default'}
          disabled={disabled}
          onClick={handleToggleLoad}
        >
          {pendingAction === 'toggle' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Power className="size-4" />
          )}
          {pendingAction === 'toggle'
            ? data.isOn
              ? 'Turning Off…'
              : 'Turning On…'
            : data.isOn
              ? 'Turn Load Off'
              : 'Turn Load On'}
        </Button>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Set Current (A)</Label>
            <span className="text-xs text-muted-foreground">Current: {data.setCurrentA?.toFixed(2) ?? '—'} A</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={data.setCurrentA?.toFixed(2) ?? '0.00'}
              value={currentInput}
              onChange={(e) => setCurrentInput(e.target.value)}
              disabled={disabled}
            />
            <Button variant="secondary" disabled={disabled || currentInput === ''} onClick={handleSetCurrent}>
              {pendingAction === 'current' ? <Loader2 className="size-4 animate-spin" /> : 'Set'}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Cut-off Voltage (V)</Label>
            <span className="text-xs text-muted-foreground">Current: {data.setCutoffV?.toFixed(2) ?? '—'} V</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder={data.setCutoffV?.toFixed(2) ?? '0.00'}
              value={cutoffInput}
              onChange={(e) => setCutoffInput(e.target.value)}
              disabled={disabled}
            />
            <Button variant="secondary" disabled={disabled || cutoffInput === ''} onClick={handleSetCutoff}>
              {pendingAction === 'cutoff' ? <Loader2 className="size-4 animate-spin" /> : 'Set'}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>Timeout (min, 0 = off)</Label>
            <span className="text-xs text-muted-foreground">
              Current: {data.setTimerS != null ? (data.setTimerS / 60).toFixed(1) : '—'} min
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              step="1"
              min="0"
              placeholder={data.setTimerS != null ? (data.setTimerS / 60).toFixed(0) : '0'}
              value={timeoutInput}
              onChange={(e) => setTimeoutInput(e.target.value)}
              disabled={disabled}
            />
            <Button variant="secondary" disabled={disabled || timeoutInput === ''} onClick={handleSetTimeout}>
              {pendingAction === 'timeout' ? <Loader2 className="size-4 animate-spin" /> : 'Set'}
            </Button>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled} className="self-start">
              {pendingAction === 'reset' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              {pendingAction === 'reset' ? 'Resetting…' : 'Reset Counters'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset accumulated counters?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears the device&apos;s accumulated capacity (Ah) and energy (Wh) counters. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
