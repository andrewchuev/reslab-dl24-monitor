//! Shared application state: the background serial-polling worker handle and its command queue.

use parking_lot::Mutex;
use std::sync::{atomic::AtomicBool, mpsc, Arc};
use std::thread::JoinHandle;

/// A hardware write request plus a one-shot channel to report the outcome back
/// to the Tauri command that issued it.
pub enum ControlCommand {
    SetOnOff(bool, mpsc::Sender<Result<(), String>>),
    SetCurrent(f64, mpsc::Sender<Result<(), String>>),
    SetCutoff(f64, mpsc::Sender<Result<(), String>>),
    SetTimeout(u32, mpsc::Sender<Result<(), String>>),
    ResetCounters(mpsc::Sender<Result<(), String>>),
}

/// Wakes the worker's blocking wait for one of two reasons: shut down, or run a
/// queued hardware write. Using one channel for both means the worker's poll-cycle
/// wait (`recv_timeout`) doubles as the wake-up mechanism for pending commands,
/// instead of only being checked once per poll interval.
pub enum WorkerEvent {
    Stop,
    Control(ControlCommand),
}

#[derive(Default)]
pub struct MonitorState {
    pub worker: Option<JoinHandle<()>>,
    // Still threaded into send_command/get_val for mid-transaction cancellation:
    // a blocking port.read() can't watch a channel, only an AtomicBool, mid-call.
    pub stop_flag: Arc<AtomicBool>,
    pub command_tx: Option<mpsc::Sender<WorkerEvent>>,
}

#[derive(Default)]
pub struct AppState {
    pub monitor: Mutex<MonitorState>,
}
