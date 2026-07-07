import { useState } from 'react';
import { Loader2, Power, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
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
import { logAction, logError } from '../utils/log';

interface ControlCenterProps {
  connected: boolean;
  data: DeviceMetrics;
}

type CommandResult = Awaited<ReturnType<typeof commands.resetCounters>>;

async function runCommand(label: string, action: () => Promise<CommandResult>, successMessage: string) {
  logAction(`control_center.${label}`);
  try {
    const result = await action();
    if (result.status === 'error') {
      logError(`control_center.${label} failed`, { error: result.error });
      toast.error(result.error);
    } else {
      toast.success(successMessage);
    }
  } catch (err) {
    logError(`control_center.${label} threw`, { error: String(err) });
    toast.error(String(err));
  }
}

type PendingAction = 'toggle' | 'current' | 'cutoff' | 'timeout' | 'reset' | null;

function currentValueLabel(t: TFunction, value: number | null | undefined, unit: string, decimals = 2): string {
  return t('controlCenter.currentValue', { value: value?.toFixed(decimals) ?? '—', unit });
}

export default function ControlCenter({ connected, data }: ControlCenterProps) {
  const { t } = useTranslation();
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
      runCommand(
        `set_load_on(${!data.isOn})`,
        () => commands.setLoadOn(!data.isOn),
        data.isOn ? t('controlCenter.toastLoadOff') : t('controlCenter.toastLoadOn')
      )
    );

  const handleSetCurrent = () => {
    const amps = parseFloat(currentInput);
    if (Number.isNaN(amps)) return;
    withPending('current', () =>
      runCommand(`set_current(${amps})`, () => commands.setCurrent(amps), t('controlCenter.toastCurrentSet', { value: amps.toFixed(2) }))
    );
  };

  const handleSetCutoff = () => {
    const volts = parseFloat(cutoffInput);
    if (Number.isNaN(volts)) return;
    withPending('cutoff', () =>
      runCommand(
        `set_cutoff(${volts})`,
        () => commands.setCutoffVoltage(volts),
        t('controlCenter.toastCutoffSet', { value: volts.toFixed(2) })
      )
    );
  };

  const handleSetTimeout = () => {
    const minutes = parseFloat(timeoutInput);
    if (Number.isNaN(minutes)) return;
    withPending('timeout', () =>
      runCommand(
        `set_timeout(${minutes}min)`,
        () => commands.setTimeoutSeconds(Math.round(minutes * 60)),
        t('controlCenter.toastTimeoutSet', { value: minutes })
      )
    );
  };

  const handleReset = () =>
    withPending('reset', () =>
      runCommand('reset_counters', () => commands.resetCounters(), t('controlCenter.toastCountersReset'))
    );

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('controlCenter.heading')}</h2>
        {/* PX-100 only supports fixed constant-current mode: no mode-switch
            command exists in the protocol, so this is a label, not a selector. */}
        <Badge variant="outline">{t('controlCenter.modeFixed')}</Badge>
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
              ? t('controlCenter.turningOff')
              : t('controlCenter.turningOn')
            : data.isOn
              ? t('controlCenter.turnOff')
              : t('controlCenter.turnOn')}
        </Button>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>{t('controlCenter.setCurrent')}</Label>
            <span className="text-xs text-muted-foreground">{currentValueLabel(t, data.setCurrentA, 'A')}</span>
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
              {pendingAction === 'current' ? <Loader2 className="size-4 animate-spin" /> : t('controlCenter.set')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>{t('controlCenter.cutoffVoltage')}</Label>
            <span className="text-xs text-muted-foreground">{currentValueLabel(t, data.setCutoffV, 'V')}</span>
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
              {pendingAction === 'cutoff' ? <Loader2 className="size-4 animate-spin" /> : t('controlCenter.set')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label>{t('controlCenter.timeout')}</Label>
            <span className="text-xs text-muted-foreground">
              {currentValueLabel(t, data.setTimerS != null ? data.setTimerS / 60 : null, t('controlCenter.minutesUnit'), 1)}
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
              {pendingAction === 'timeout' ? <Loader2 className="size-4 animate-spin" /> : t('controlCenter.set')}
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
              {pendingAction === 'reset' ? t('controlCenter.resetting') : t('controlCenter.resetCounters')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('controlCenter.resetDialogTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('controlCenter.resetDialogDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('controlCenter.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset}>{t('controlCenter.reset')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
