import { useEffect, useMemo, useRef, useState } from 'react';
import { commands, events } from './bindings';
import type { ConnectionStatusEvent_Deserialize } from './bindings';
import ControlCenter from './components/ControlCenter';
import HeroMetrics from './components/HeroMetrics';
import SecondaryMetrics from './components/SecondaryMetrics';
import StatusHeader from './components/StatusHeader';
import TelemetryCharts from './components/TelemetryCharts';
import type { AppSettings, DeviceMetrics, TimeRange } from './types';
import { loadLastPort, saveLastPort } from './utils/lastPort';
import { logAction, logError, logInfo } from './utils/log';
import { buildCandidateQueue } from './utils/ports';
import { loadSettings, saveSettings } from './utils/settings';

const FAILED_STAGES = new Set(['probe_failed', 'error', 'validation']);

type ConnectionStatus = Partial<ConnectionStatusEvent_Deserialize>;

interface DashboardProps {
    themeMode: 'light' | 'dark';
    setThemeMode: (mode: 'light' | 'dark') => void;
}

export default function Dashboard({ themeMode, setThemeMode }: DashboardProps) {
    const [data, setData] = useState<DeviceMetrics>({
        voltageV: null,
        currentA: null,
        capacityMAh: null,
        powerW: null,
        tempC: null,
        runtimeS: null,
        energyWh: null,
        isOn: null,
        setCurrentA: null,
        setCutoffV: null,
        setTimerS: null,
    });
    const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

    const [connected, setConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [ports, setPorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState<string | null>(null);
    // Remaining candidate ports to try, in order, while auto-detecting the
    // device on startup. null means "not auto-detecting" (idle, or a manual
    // connect is in progress).
    const [autoDetectQueue, setAutoDetectQueue] = useState<string[] | null>(null);
    const [hasData, setHasData] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [timeRange, setTimeRange] = useState<TimeRange>('5m');
    const [renderTick, setRenderTick] = useState(0);
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
        connected: false,
        stage: 'disconnected',
    });

    const chartDataRef = useRef({
        startTime: null as number | null,
        times: [] as number[],
        voltage: [] as number[],
        current: [] as number[],
        power: [] as number[],
    });

    const lastRenderRef = useRef(0);
    // Guards the auto-detect kick-off so it only ever runs once, even though
    // the effect that triggers it (after the event listeners are ready) can
    // re-run later when settings change.
    const autoDetectStartedRef = useRef(false);

    // ==================== Handlers ====================
    async function fetchPorts() {
        try {
            const list = await commands.listPorts();
            setPorts(list);
            logAction('refresh_ports', { found: list });
            return list;
        } catch (err) {
            console.error('Failed to fetch ports:', err);
            logError('refresh_ports failed', { error: String(err) });
            return [];
        }
    }

    async function handleConnect(portOverride?: string) {
        const port = portOverride ?? selectedPort;
        if (!port || connected) return;
        logAction('connect_click', { port, pollIntervalMs: settings.pollIntervalMs });
        setIsConnecting(true);
        setConnectionStatus({ connected: false, stage: 'probing', attempt: 0 });
        chartDataRef.current = { startTime: null, times: [], voltage: [], current: [], power: [] };
        setHasData(false);
        try {
            const result = await commands.connectPort(port, settings.pollIntervalMs);
            if (result.status === 'error') {
                console.error('Connection error:', result.error);
                logError('connect_port failed', { error: result.error });
                setConnectionStatus({ connected: false, error: result.error, stage: 'error' });
            }
        } catch (err) {
            console.error('Connection error:', err);
            logError('connect_port threw', { error: String(err) });
            setConnectionStatus({ connected: false, error: String(err), stage: 'error' });
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleDisconnect() {
        if (!connected) return;
        logAction('disconnect_click');
        setAutoDetectQueue(null);
        setIsConnecting(true);
        try {
            const result = await commands.disconnectPort();
            if (result.status === 'error') {
                console.error('Disconnect error:', result.error);
                logError('disconnect_port failed', { error: result.error });
            }
        } catch (err) {
            console.error('Disconnect error:', err);
            logError('disconnect_port threw', { error: String(err) });
        } finally {
            setIsConnecting(false);
        }
    }

    const scheduleUpdate = () => {
        const now = Date.now();
        if (now - lastRenderRef.current < settings.chartRefreshMs) return;
        lastRenderRef.current = now;
        setRenderTick((t) => t + 1);
    };

    const resetChart = () => {
        logAction('reset_chart_click', { pointsDiscarded: chartDataRef.current.times.length });
        chartDataRef.current = { startTime: null, times: [], voltage: [], current: [], power: [] };
        setHasData(false);
        setRenderTick((t) => t + 1);
    };

    const togglePause = () => {
        setIsPaused((v) => {
            logAction(v ? 'resume_click' : 'pause_click');
            return !v;
        });
    };

    const exportCsv = () => {
        const { times, voltage, current, power } = chartDataRef.current;
        if (!times.length) return;
        const rows = ['time_s,voltage_v,current_a,power_w'];
        for (let i = 0; i < times.length; i += 1) {
            rows.push(`${times[i].toFixed(3)},${voltage[i].toFixed(6)},${current[i].toFixed(6)},${power[i].toFixed(6)}`);
        }
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        logAction('export_csv_click', { points: times.length });
    };

    const chartSnapshot = useMemo(
        () => ({
            times: [...chartDataRef.current.times],
            voltage: [...chartDataRef.current.voltage],
            current: [...chartDataRef.current.current],
            power: [...chartDataRef.current.power],
        }),
        [renderTick]
    );

    // ==================== Effects ====================
    // Advances to the next candidate port on failure, stops on success.
    useEffect(() => {
        if (autoDetectQueue === null) return;
        const stage = connectionStatus.stage;

        if (stage === 'connected') {
            logAction('auto_detect_success', { port: selectedPort });
            setAutoDetectQueue(null);
            return;
        }

        if (stage && FAILED_STAGES.has(stage)) {
            if (autoDetectQueue.length === 0) {
                logAction('auto_detect_exhausted');
                setAutoDetectQueue(null);
                return;
            }
            const [next, ...rest] = autoDetectQueue;
            setAutoDetectQueue(rest);
            setSelectedPort(next);
            handleConnect(next);
        }
    }, [connectionStatus]);

    // Remembers whichever port last connected successfully, regardless of
    // whether that came from auto-detect or a manual pick.
    useEffect(() => {
        if (connectionStatus.stage === 'connected' && selectedPort) {
            saveLastPort(selectedPort);
        }
    }, [connectionStatus.stage, selectedPort]);

    useEffect(() => {
        saveSettings(settings);
    }, [settings]);

    function handleSettingsChange(next: AppSettings) {
        logAction('settings_change', next);
        setSettings(next);
    }

    useEffect(() => {
        let unsubDevice: (() => void) | undefined;
        let unsubConn: (() => void) | undefined;

        (async () => {
            unsubDevice = await events.deviceDataEvent.listen((event) => {
                const payload = event.payload;
                setData(payload);

                if (isPaused) return;

                if (payload.voltageV == null && payload.currentA == null) return;

                const now = Date.now();
                const ref = chartDataRef.current;

                if (!ref.startTime) ref.startTime = now;

                const seconds = (now - ref.startTime) / 1000;

                ref.times.push(seconds);
                ref.voltage.push(Number(payload.voltageV ?? 0));
                ref.current.push(Number(payload.currentA ?? 0));
                ref.power.push(Number(payload.powerW ?? 0));

                if (ref.times.length > settings.maxPoints) {
                    const cut = ref.times.length - settings.maxPoints;
                    ref.times.splice(0, cut);
                    ref.voltage.splice(0, cut);
                    ref.current.splice(0, cut);
                    ref.power.splice(0, cut);
                    ref.startTime = now - ref.times[0] * 1000;
                }

                setHasData(true);
                scheduleUpdate();
            });

            unsubConn = await events.connectionStatusEvent.listen((event) => {
                const st = event.payload;
                logInfo('connection_status', {
                    stage: st.stage,
                    connected: st.connected,
                    attempt: st.attempt,
                    error: st.error,
                });
                setConnectionStatus(st);
                setConnected(st.connected);
                setIsConnecting(st.stage === 'probing');
                if (st.error) console.error('Connection error:', st.error);
            });

            // Only start auto-detecting once both listeners above are
            // actually attached - kicking off a connect attempt any earlier
            // risks the resulting connection-status events firing before
            // anything is listening for them, which would leave the scan
            // stuck forever waiting for a status change that already
            // happened. Guarded by a ref so re-running this effect later
            // (e.g. when settings change) doesn't restart the scan.
            if (!autoDetectStartedRef.current) {
                autoDetectStartedRef.current = true;
                const list = await fetchPorts();
                if (list.length > 0) {
                    const lastPort = loadLastPort();
                    const queue = buildCandidateQueue(list, lastPort);
                    const [first, ...rest] = queue;
                    setSelectedPort(first);
                    setAutoDetectQueue(rest);
                    logAction('auto_detect_start', { candidates: queue, lastPort });
                    handleConnect(first);
                }
            }
        })();

        return () => {
            unsubDevice?.();
            unsubConn?.();
        };
    }, [isPaused, settings.maxPoints, settings.chartRefreshMs]);

    return (
        <div className="h-full">
            <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 md:gap-8 md:py-6 lg:px-8">
                <section className="w-full">
                    <StatusHeader
                        ports={ports}
                        selectedPort={selectedPort}
                        onSelectPort={setSelectedPort}
                        onRefresh={fetchPorts}
                        onConnectToggle={connected ? handleDisconnect : () => handleConnect()}
                        connected={connected}
                        isConnecting={isConnecting}
                        isAutoDetecting={autoDetectQueue !== null}
                        themeMode={themeMode}
                        setThemeMode={setThemeMode}
                        status={connectionStatus}
                        settings={settings}
                        onSettingsChange={handleSettingsChange}
                    />
                </section>

                <section className="w-full">
                    <HeroMetrics data={data} />
                </section>

                <section className="grid w-full grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2">
                        <TelemetryCharts
                            hasData={hasData}
                            times={chartSnapshot.times}
                            voltage={chartSnapshot.voltage}
                            current={chartSnapshot.current}
                            power={chartSnapshot.power}
                            timeRange={timeRange}
                            onTimeRangeChange={setTimeRange}
                            isPaused={isPaused}
                            onPauseResume={togglePause}
                            onReset={resetChart}
                            onExportCsv={exportCsv}
                        />
                    </div>
                    <div>
                        <ControlCenter connected={connected} data={data} />
                    </div>
                </section>

                <section className="w-full pb-2">
                    <SecondaryMetrics data={data} />
                </section>
            </div>
        </div>
    );
}
