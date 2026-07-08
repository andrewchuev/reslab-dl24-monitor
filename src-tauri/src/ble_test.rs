//! Verification/debug spike for BLE control over `tauri-plugin-blec` - NOT
//! the production transport (see `ble.rs` for that). Kept around as a
//! standing debug tool: it independently exercises connect/subscribe/write
//! against the real device with verbose logging at every step, which is
//! useful when diagnosing a *new* BLE issue without wading through the
//! production worker-thread machinery in `commands.rs`.
//!
//! Originally written to answer: does the app's B1B2 protocol work over BLE
//! at all, including write commands (on/off, set current, reset, ...), not
//! just the read-only `FF55` telemetry the device also broadcasts
//! unprompted? Confirmed yes - see `ble.rs`'s doc comment.

use crate::ble::{hex, CHAR_UUID, SERVICE_UUID};
use crate::protocol::{HEADER, TRAILER};
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tauri_plugin_blec::models::WriteType;
use tauri_plugin_blec::OnDisconnectHandler;

const SCAN_TIMEOUT_MS: u64 = 6000;

#[tauri::command]
#[specta::specta]
pub async fn ble_scan() -> Result<Vec<crate::ble::BleDeviceInfo>, String> {
    let devices = crate::ble::scan_devices(SCAN_TIMEOUT_MS)
        .await
        .map_err(|e| e.to_string())?;

    log::info!(
        "ble_scan found {} device(s): {}",
        devices.len(),
        devices
            .iter()
            .map(|d| format!("{} ({})", d.name, d.address))
            .collect::<Vec<_>>()
            .join(", ")
    );

    Ok(devices)
}

/// Connects to `address`, subscribes to FFE1 notifications, sends a B1B2
/// voltage query (read) and a B1B2 reset-counters command (write), then
/// disconnects. Returns every notification received in between as hex
/// strings - if the reset-counters write produced an ACK-shaped reply the
/// same way it does over SPP, BLE control is viable.
#[tauri::command]
#[specta::specta]
pub async fn ble_probe(address: String) -> Result<Vec<String>, String> {
    let handler = tauri_plugin_blec::get_handler().map_err(|e| e.to_string())?;
    let service = uuid::Uuid::parse_str(SERVICE_UUID).unwrap();
    let characteristic = uuid::Uuid::parse_str(CHAR_UUID).unwrap();

    log::info!("ble_probe: connecting to {address}");
    handler
        .connect(
            &address,
            OnDisconnectHandler::Sync(Box::new(|| log::info!("ble_probe: device disconnected"))),
            false,
        )
        .await
        .map_err(|e| format!("connect: {e}"))?;

    log::info!("ble_probe: connect() returned Ok, is_connected={}", handler.is_connected());

    // Give the Windows GATT stack a moment to finish service discovery before
    // touching characteristics - some devices report "connected" slightly
    // before service enumeration has actually settled.
    tokio::time::sleep(Duration::from_millis(800)).await;
    log::info!(
        "ble_probe: after settle delay, is_connected={}",
        handler.is_connected()
    );

    match handler.discover_services(&address).await {
        Ok(services) => {
            for svc in &services {
                log::info!(
                    "ble_probe: service {} chars=[{}]",
                    svc.uuid,
                    svc.characteristics
                        .iter()
                        .map(|c| format!("{} props={:?}", c.uuid, c.properties))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
        Err(e) => log::warn!("ble_probe: discover_services failed: {e}"),
    }

    let (note_tx, note_rx) = std_mpsc::channel::<Vec<u8>>();
    handler
        .subscribe(characteristic, Some(service), move |data: Vec<u8>| {
            log::debug!("BLE RX: {}", hex(&data));
            let _ = note_tx.send(data);
        })
        .await
        .map_err(|e| format!("subscribe (is_connected={}): {e}", handler.is_connected()))?;

    // B1B2 VOLTAGE query (read) - sanity check the link works at all.
    let query_frame = [HEADER[0], HEADER[1], crate::protocol::VOLTAGE, 0, 0, TRAILER];
    log::debug!("BLE TX: {}", hex(&query_frame));
    handler
        .send_data(characteristic, Some(service), &query_frame, WriteType::WithoutResponse)
        .await
        .map_err(|e| format!("send query (is_connected={}): {e}", handler.is_connected()))?;
    tokio::time::sleep(Duration::from_millis(1500)).await;

    // B1B2 reset-counters (write) - the actual thing we need to confirm.
    let reset_frame = [HEADER[0], HEADER[1], crate::protocol::CMD_RESET, 0, 0, TRAILER];
    log::debug!("BLE TX: {}", hex(&reset_frame));
    handler
        .send_data(characteristic, Some(service), &reset_frame, WriteType::WithoutResponse)
        .await
        .map_err(|e| format!("send reset (is_connected={}): {e}", handler.is_connected()))?;
    tokio::time::sleep(Duration::from_millis(1500)).await;

    let _ = handler.unsubscribe(characteristic).await;
    let _ = handler.disconnect().await;

    let mut received = Vec::new();
    while let Ok(data) = note_rx.try_recv() {
        received.push(hex(&data));
    }

    log::info!("ble_probe: got {} notification(s): {received:?}", received.len());
    Ok(received)
}
