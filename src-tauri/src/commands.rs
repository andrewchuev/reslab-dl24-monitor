//! Tauri commands and the device-data / connection-status events emitted to the frontend.

use crate::protocol::{self, Val};
use crate::serial::{self, DataStore};
use crate::state::{AppState, ControlCommand, WorkerEvent};
use anyhow::{Context, Result};
use serde::Serialize;
use specta::Type;
use std::{
    sync::{atomic::Ordering, mpsc, mpsc::RecvTimeoutError},
    thread,
    time::Duration,
};
use tauri::{AppHandle, State};
use tauri_specta::Event;

const PROBE_ATTEMPTS: u8 = 3;
const PROBE_RETRY_DELAY_MS: u64 = 250;
const POLL_INTERVAL_DEFAULT_MS: u32 = 1500;
const POLL_INTERVAL_MIN_MS: u32 = 300;
const POLL_INTERVAL_MAX_MS: u32 = 10000;
/// How long a Tauri control command waits for the worker thread to execute a
/// hardware write and reply. Generous enough to cover a couple of retry cycles;
/// a connection so broken that every read/write keeps failing will correctly
/// surface as a timeout error here rather than hang the UI.
const CONTROL_REPLY_TIMEOUT_MS: u64 = 5000;

#[derive(Serialize, Clone, Type, Event)]
pub struct DeviceDataEvent {
    #[serde(rename = "type")]
    kind: &'static str,

    #[serde(rename = "voltageV")]
    voltage_v: f64,
    #[serde(rename = "currentA")]
    current_a: f64,
    #[serde(rename = "capacityMAh")]
    capacity_mah: f64,
    #[serde(rename = "powerW")]
    power_w: String,
    #[serde(rename = "tempC")]
    temp_c: f64,
    #[serde(rename = "runtimeS")]
    runtime_s: u32,
    #[serde(rename = "energyWh")]
    energy_wh: f64,

    #[serde(rename = "isOn")]
    is_on: bool,
    #[serde(rename = "setCurrentA")]
    set_current_a: f64,
    #[serde(rename = "setCutoffV")]
    set_cutoff_v: f64,
    #[serde(rename = "setTimerS")]
    set_timer_s: u32,
}

#[derive(Serialize, Clone, Type, Event)]
pub struct ConnectionStatusEvent {
    connected: bool,
    error: Option<String>,
    #[serde(rename = "stage", skip_serializing_if = "Option::is_none")]
    stage: Option<String>,
    #[serde(rename = "attempt", skip_serializing_if = "Option::is_none")]
    attempt: Option<u8>,
    #[serde(rename = "maxAttempts", skip_serializing_if = "Option::is_none")]
    max_attempts: Option<u8>,
}

fn emit_connection(
    app: &AppHandle,
    connected: bool,
    error: Option<String>,
    stage: Option<String>,
    attempt: Option<u8>,
    max_attempts: Option<u8>,
) {
    let _ = ConnectionStatusEvent {
        connected,
        error,
        stage,
        attempt,
        max_attempts,
    }
    .emit(app);
}

fn emit_device(app: &AppHandle, ds: &DataStore) {
    let power = ds.voltage * ds.current;
    let power_str = format!("{power:.2}");

    let _ = DeviceDataEvent {
        kind: "status",
        voltage_v: ds.voltage,
        current_a: ds.current,
        capacity_mah: ds.cap_ah * 1000.0,
        power_w: power_str,
        temp_c: ds.temp,
        runtime_s: protocol::runtime_seconds(&ds.time),
        energy_wh: ds.cap_wh,
        is_on: ds.is_on > 0.5,
        set_current_a: ds.set_current,
        set_cutoff_v: ds.set_voltage,
        set_timer_s: protocol::runtime_seconds(&ds.set_timer),
    }
    .emit(app);
}

#[tauri::command]
#[specta::specta]
pub fn list_ports() -> Vec<String> {
    serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub fn disconnect_port(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let mut mon = state.monitor.lock();
    if let Some(handle) = mon.worker.take() {
        // Two wake-up signals so the worker exits promptly regardless of what
        // it's doing: stop_flag interrupts a send_command mid-transaction,
        // WorkerEvent::Stop wakes it immediately if it's idle in recv_timeout.
        mon.stop_flag.store(true, Ordering::SeqCst);
        if let Some(tx) = mon.command_tx.take() {
            let _ = tx.send(WorkerEvent::Stop);
        }
        if let Err(panic) = handle.join() {
            log::error!("monitor thread panicked: {panic:?}");
        }
    }
    mon.stop_flag.store(false, Ordering::SeqCst);
    mon.command_tx = None;
    log::info!("port disconnected");
    emit_connection(&app, false, None, Some("disconnected".into()), None, None);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn connect_port(
    app: AppHandle,
    state: State<'_, AppState>,
    port_path: String,
    poll_interval_ms: Option<u32>,
) -> Result<(), String> {
    disconnect_port(app.clone(), state.clone())?;

    if port_path.trim().is_empty() {
        emit_connection(
            &app,
            false,
            Some("No port selected".into()),
            Some("validation".into()),
            None,
            None,
        );
        return Ok(());
    }

    if !list_ports().iter().any(|p| p == &port_path) {
        emit_connection(
            &app,
            false,
            Some(format!("Port not found: {port_path}")),
            Some("validation".into()),
            None,
            None,
        );
        return Ok(());
    }

    let mut mon = state.monitor.lock();
    let stop = mon.stop_flag.clone();
    let (command_tx, command_rx) = mpsc::channel::<WorkerEvent>();
    mon.command_tx = Some(command_tx);
    let app_for_thread = app.clone();
    let poll_ms = poll_interval_ms
        .unwrap_or(POLL_INTERVAL_DEFAULT_MS)
        .clamp(POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS);
    let poll_interval = Duration::from_millis(poll_ms as u64);

    mon.worker = Some(thread::spawn(move || {
        let res: Result<()> = (|| {
            let mut port = serialport::new(&port_path, serial::BAUD)
                .data_bits(serialport::DataBits::Eight)
                .stop_bits(serialport::StopBits::One)
                .parity(serialport::Parity::None)
                .timeout(Duration::from_millis(serial::COMMAND_TIMEOUT_MS))
                .open()
                .with_context(|| format!("Failed to open port {port_path}"))?;

            emit_connection(
                &app_for_thread,
                false,
                None,
                Some("probing".into()),
                Some(0),
                Some(PROBE_ATTEMPTS),
            );

            let mut probe_ok = false;
            for attempt in 1..=PROBE_ATTEMPTS {
                emit_connection(
                    &app_for_thread,
                    false,
                    None,
                    Some("probing".into()),
                    Some(attempt),
                    Some(PROBE_ATTEMPTS),
                );

                if let Some(Val::Num(_)) =
                    serial::get_val(&mut *port, protocol::VOLTAGE, 1, &stop)?
                {
                    probe_ok = true;
                    break;
                }
                serial::interruptible_sleep(&stop, PROBE_RETRY_DELAY_MS);
            }

            if !probe_ok {
                log::warn!("probe failed on port {port_path} after {PROBE_ATTEMPTS} attempts");
                emit_connection(
                    &app_for_thread,
                    false,
                    Some("Probe failed".into()),
                    Some("probe_failed".into()),
                    Some(PROBE_ATTEMPTS),
                    Some(PROBE_ATTEMPTS),
                );
                return Ok(());
            }

            log::info!("connected to {port_path}");
            emit_connection(&app_for_thread, true, None, Some("connected".into()), None, None);

            let mut ds = DataStore {
                time: "00:00:00".into(),
                set_timer: "00:00:00".into(),
                ..Default::default()
            };

            let mut aux_index: usize = 0;

            loop {
                // recv_timeout doubles as the poll-cycle wait: a queued control
                // command wakes it immediately instead of sitting unprocessed
                // for up to poll_ms.
                match command_rx.recv_timeout(poll_interval) {
                    Ok(WorkerEvent::Stop) => break,
                    Ok(WorkerEvent::Control(cmd)) => {
                        handle_control_command(&mut *port, cmd, &stop);
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }

                if stop.load(Ordering::SeqCst) {
                    break;
                }
                if let Err(e) = serial::read_all(&mut *port, &mut ds, &mut aux_index, false, &stop)
                {
                    log::warn!("read_all failed, keeping last known values: {e}");
                }
                emit_device(&app_for_thread, &ds);
            }

            Ok(())
        })();

        if let Err(e) = res {
            log::error!("monitor thread for {port_path} exited with error: {e}");
            emit_connection(
                &app_for_thread,
                false,
                Some(e.to_string()),
                Some("error".into()),
                None,
                None,
            );
        }
    }));

    Ok(())
}

/// Runs a queued hardware write on the worker thread and reports the outcome
/// back on its embedded reply channel. Errors sending the reply are ignored:
/// it only fails if the Tauri command already gave up waiting (recv_timeout
/// elapsed), in which case there's no one left to tell.
fn handle_control_command(port: &mut dyn serialport::SerialPort, cmd: ControlCommand, stop: &std::sync::atomic::AtomicBool) {
    let (result, reply_tx) = match cmd {
        ControlCommand::SetOnOff(on, reply) => (serial::set_onoff(port, on, stop), reply),
        ControlCommand::SetCurrent(amps, reply) => (serial::set_current(port, amps, stop), reply),
        ControlCommand::SetCutoff(volts, reply) => (serial::set_cutoff(port, volts, stop), reply),
        ControlCommand::SetTimeout(secs, reply) => (serial::set_timeout(port, secs, stop), reply),
        ControlCommand::ResetCounters(reply) => (serial::reset_counters(port, stop), reply),
    };
    let _ = reply_tx.send(result.map_err(|e| e.to_string()));
}

/// Enqueues a control command for the worker thread and blocks for its reply.
/// Clones the sender and releases the `state.monitor` lock *before* the
/// blocking wait: holding it would stall disconnect_port and any other
/// concurrent control command for the full reply timeout.
fn send_control_command(
    state: &State<'_, AppState>,
    build: impl FnOnce(mpsc::Sender<Result<(), String>>) -> ControlCommand,
) -> Result<(), String> {
    let tx = state
        .monitor
        .lock()
        .command_tx
        .clone()
        .ok_or_else(|| "Not connected".to_string())?;

    let (reply_tx, reply_rx) = mpsc::channel();
    tx.send(WorkerEvent::Control(build(reply_tx)))
        .map_err(|_| "Worker not running".to_string())?;

    reply_rx
        .recv_timeout(Duration::from_millis(CONTROL_REPLY_TIMEOUT_MS))
        .map_err(|_| "Device did not respond in time".to_string())?
}

#[tauri::command]
#[specta::specta]
pub fn set_load_on(state: State<'_, AppState>, on: bool) -> Result<(), String> {
    send_control_command(&state, |reply| ControlCommand::SetOnOff(on, reply))
}

#[tauri::command]
#[specta::specta]
pub fn set_current(state: State<'_, AppState>, amps: f64) -> Result<(), String> {
    send_control_command(&state, |reply| ControlCommand::SetCurrent(amps, reply))
}

#[tauri::command]
#[specta::specta]
pub fn set_cutoff_voltage(state: State<'_, AppState>, volts: f64) -> Result<(), String> {
    send_control_command(&state, |reply| ControlCommand::SetCutoff(volts, reply))
}

#[tauri::command]
#[specta::specta]
pub fn set_timeout_seconds(state: State<'_, AppState>, seconds: u32) -> Result<(), String> {
    send_control_command(&state, |reply| ControlCommand::SetTimeout(seconds, reply))
}

#[tauri::command]
#[specta::specta]
pub fn reset_counters(state: State<'_, AppState>) -> Result<(), String> {
    send_control_command(&state, ControlCommand::ResetCounters)
}
