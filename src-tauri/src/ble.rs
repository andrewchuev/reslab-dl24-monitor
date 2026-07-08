//! Production BLE transport: a `serialport::SerialPort` shim over
//! `tauri-plugin-blec`'s GATT connection, so every existing B1B2 protocol
//! function in `serial.rs` (`send_command`, `get_val`, `read_all`,
//! `write_command`, `clear_buffer`, ...) runs completely unchanged over BLE.
//! That logic was validated against SPP for months and, per the `ble_test`
//! debug spike, tunnels through this exact characteristic unmodified -
//! including write commands, not just reads.
//!
//! The device exposes the standard "transparent UART over BLE" service used
//! by this device family: service `FFE0`, characteristic `FFE1`
//! (write + notify).

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use serialport::{ClearBuffer, DataBits, FlowControl, Parity, StopBits};
use specta::Type;
use std::io::{self, Read, Write};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tauri_plugin_blec::models::{BleDevice, ScanFilter, WriteType};
use tauri_plugin_blec::OnDisconnectHandler;
use uuid::Uuid;

pub const SERVICE_UUID: &str = "0000ffe0-0000-1000-8000-00805f9b34fb";
pub const CHAR_UUID: &str = "0000ffe1-0000-1000-8000-00805f9b34fb";

const CONNECT_ATTEMPTS: u8 = 3;
const CONNECT_RETRY_DELAY_MS: u64 = 500;
const DEFAULT_SCAN_TIMEOUT_MS: u64 = 6000;
/// Matches `serial::COMMAND_TIMEOUT_MS` - `send_command`'s read loop expects
/// a similar deadline regardless of transport.
const DEFAULT_READ_TIMEOUT_MS: u64 = 1200;

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

fn service_uuid() -> Uuid {
    Uuid::parse_str(SERVICE_UUID).expect("SERVICE_UUID is a valid UUID literal")
}

fn char_uuid() -> Uuid {
    Uuid::parse_str(CHAR_UUID).expect("CHAR_UUID is a valid UUID literal")
}

#[derive(Serialize, Type)]
pub struct BleDeviceInfo {
    pub name: String,
    pub address: String,
    pub rssi: Option<i16>,
}

impl From<BleDevice> for BleDeviceInfo {
    fn from(d: BleDevice) -> Self {
        Self {
            name: d.name,
            address: d.address,
            rssi: d.rssi,
        }
    }
}

/// Scans for nearby BLE devices for `timeout_ms`. Shared by the production
/// connect flow (`list_ble_devices`) and the `ble_test` debug panel, so the
/// two can never drift apart.
pub async fn scan_devices(timeout_ms: u64) -> Result<Vec<BleDeviceInfo>> {
    // No-op on desktop; on Android this triggers the runtime Bluetooth/
    // location permission prompt the first time it's needed.
    if !tauri_plugin_blec::check_permissions(true).map_err(|e| anyhow!(e.to_string()))? {
        return Err(anyhow!("Bluetooth permission not granted"));
    }

    let handler = tauri_plugin_blec::get_handler().map_err(|e| anyhow!(e.to_string()))?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<BleDevice>>(16);
    handler
        .discover(Some(tx), timeout_ms, ScanFilter::None, false)
        .await
        .map_err(|e| anyhow!(e.to_string()))?;

    let mut latest: Vec<BleDevice> = Vec::new();
    while let Some(found) = rx.recv().await {
        latest = found;
    }
    Ok(latest.into_iter().map(BleDeviceInfo::from).collect())
}

#[tauri::command]
#[specta::specta]
pub async fn list_ble_devices() -> Result<Vec<BleDeviceInfo>, String> {
    scan_devices(DEFAULT_SCAN_TIMEOUT_MS).await.map_err(|e| e.to_string())
}

/// `serialport::SerialPort` shim over a BLE GATT connection. Reads pull from
/// notifications on `FFE1`, writes go out on the same characteristic - the
/// device's "transparent UART" design means this looks exactly like a serial
/// port to everything in `serial.rs`.
pub struct BleSerialPort {
    address: String,
    rx: std_mpsc::Receiver<Vec<u8>>,
    leftover: Vec<u8>,
    timeout: Duration,
}

impl BleSerialPort {
    /// Connects to `address`, retrying a few times - the BLE spike saw one
    /// `Not connected` failure before two clean connects in a row, so a
    /// single attempt isn't reliable enough for the real connect flow.
    pub fn connect(address: &str) -> Result<Self> {
        let handler = tauri_plugin_blec::get_handler().map_err(|e| anyhow!(e.to_string()))?;

        let mut last_err = None;
        let mut connected = false;
        for attempt in 1..=CONNECT_ATTEMPTS {
            let addr_for_callback = address.to_string();
            let result = tauri::async_runtime::block_on(handler.connect(
                address,
                OnDisconnectHandler::Sync(Box::new(move || {
                    log::info!("BLE device {addr_for_callback} disconnected");
                })),
                false,
            ));
            match result {
                Ok(()) => {
                    connected = true;
                    break;
                }
                Err(e) => {
                    log::warn!(
                        "BLE connect attempt {attempt}/{CONNECT_ATTEMPTS} to {address} failed: {e}"
                    );
                    last_err = Some(e);
                    if attempt < CONNECT_ATTEMPTS {
                        std::thread::sleep(Duration::from_millis(CONNECT_RETRY_DELAY_MS));
                    }
                }
            }
        }
        if !connected {
            return Err(anyhow!(
                "Failed to connect to {address} after {CONNECT_ATTEMPTS} attempts: {}",
                last_err.map(|e| e.to_string()).unwrap_or_default()
            ));
        }

        let (tx, rx) = std_mpsc::channel::<Vec<u8>>();
        tauri::async_runtime::block_on(handler.subscribe(
            char_uuid(),
            Some(service_uuid()),
            move |data: Vec<u8>| {
                log::debug!("BLE RX: {}", hex(&data));
                let _ = tx.send(data);
            },
        ))
        .with_context(|| format!("Failed to subscribe to notifications on {address}"))?;

        Ok(Self {
            address: address.to_string(),
            rx,
            leftover: Vec::new(),
            timeout: Duration::from_millis(DEFAULT_READ_TIMEOUT_MS),
        })
    }
}

impl Read for BleSerialPort {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.leftover.is_empty() {
            match self.rx.recv_timeout(self.timeout) {
                Ok(data) => self.leftover = data,
                Err(_) => return Err(io::Error::new(io::ErrorKind::TimedOut, "BLE read timed out")),
            }
        }
        let n = buf.len().min(self.leftover.len());
        buf[..n].copy_from_slice(&self.leftover[..n]);
        self.leftover.drain(..n);
        Ok(n)
    }
}

impl Write for BleSerialPort {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let handler = tauri_plugin_blec::get_handler()
            .map_err(|e| io::Error::other(e.to_string()))?;
        log::debug!("BLE TX: {}", hex(buf));
        tauri::async_runtime::block_on(handler.send_data(
            char_uuid(),
            Some(service_uuid()),
            buf,
            WriteType::WithResponse,
        ))
        .map_err(|e| io::Error::other(e.to_string()))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for BleSerialPort {
    fn drop(&mut self) {
        let Ok(handler) = tauri_plugin_blec::get_handler() else {
            return;
        };
        let _ = tauri::async_runtime::block_on(handler.unsubscribe(char_uuid()));
        if let Err(e) = tauri::async_runtime::block_on(handler.disconnect()) {
            log::warn!("BLE disconnect for {} failed: {e}", self.address);
        }
    }
}

impl serialport::SerialPort for BleSerialPort {
    fn name(&self) -> Option<String> {
        Some(self.address.clone())
    }
    fn baud_rate(&self) -> serialport::Result<u32> {
        Ok(crate::serial::BAUD)
    }
    fn data_bits(&self) -> serialport::Result<DataBits> {
        Ok(DataBits::Eight)
    }
    fn flow_control(&self) -> serialport::Result<FlowControl> {
        Ok(FlowControl::None)
    }
    fn parity(&self) -> serialport::Result<Parity> {
        Ok(Parity::None)
    }
    fn stop_bits(&self) -> serialport::Result<StopBits> {
        Ok(StopBits::One)
    }
    fn timeout(&self) -> Duration {
        self.timeout
    }
    fn set_baud_rate(&mut self, _: u32) -> serialport::Result<()> {
        Ok(())
    }
    fn set_data_bits(&mut self, _: DataBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_flow_control(&mut self, _: FlowControl) -> serialport::Result<()> {
        Ok(())
    }
    fn set_parity(&mut self, _: Parity) -> serialport::Result<()> {
        Ok(())
    }
    fn set_stop_bits(&mut self, _: StopBits) -> serialport::Result<()> {
        Ok(())
    }
    fn set_timeout(&mut self, timeout: Duration) -> serialport::Result<()> {
        self.timeout = timeout;
        Ok(())
    }
    fn write_request_to_send(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn write_data_terminal_ready(&mut self, _: bool) -> serialport::Result<()> {
        Ok(())
    }
    fn read_clear_to_send(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_data_set_ready(&mut self) -> serialport::Result<bool> {
        Ok(true)
    }
    fn read_ring_indicator(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }
    fn read_carrier_detect(&mut self) -> serialport::Result<bool> {
        Ok(false)
    }
    fn bytes_to_read(&self) -> serialport::Result<u32> {
        Ok(self.leftover.len() as u32)
    }
    fn bytes_to_write(&self) -> serialport::Result<u32> {
        Ok(0)
    }
    fn clear(&self, _: ClearBuffer) -> serialport::Result<()> {
        Ok(())
    }
    fn try_clone(&self) -> serialport::Result<Box<dyn serialport::SerialPort>> {
        Err(serialport::Error::new(serialport::ErrorKind::Unknown, "clone not supported for BLE"))
    }
    fn set_break(&self) -> serialport::Result<()> {
        Ok(())
    }
    fn clear_break(&self) -> serialport::Result<()> {
        Ok(())
    }
}
