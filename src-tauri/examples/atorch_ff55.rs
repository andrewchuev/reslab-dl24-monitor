//! Reference decoder for the ATorch DL24 native `FF 55` broadcast protocol -
//! distinct from this app's `B1 B2` query/response protocol (see
//! `src/protocol.rs`). The device sends `FF 55` frames unprompted, in the
//! background, over the existing SPP link (captured as "stale" bytes ahead
//! of a B1B2 query - see `serial.rs`'s `clear_buffer` debug logging). Public
//! docs suggest this is the same protocol BLE delivers via the FFE1
//! characteristic, so this parser exists to decode a real BLE capture later
//! and confirm that.
//!
//! Field offsets/scale factors and the checksum formula were cross-checked
//! against this app's own B1B2-decoded telemetry from a live session,
//! including a "reset counters" action that zeroed the capacity reading in
//! both protocols simultaneously - see the test vectors below.
//!
//! Not wired into the app; run directly against a hex dump copied from a
//! session log or a BLE sniff:
//!
//! ```sh
//! cargo run --example atorch_ff55 -- "FF 55 01 02 00 00 70 00 00 00 00 00 7D 00 00 00 01 00 00 00 00 00 00 00 00 1B 00 00 2E 2B 3C 00 00 00 00 E5"
//! ```

use std::env;

#[derive(Debug, PartialEq)]
pub struct Ff55Frame {
    pub message_type: u8,
    pub device_type: u8,
    pub voltage: f64,
    pub current: f64,
    pub capacity_ah: f64,
    pub temperature_c: f64,
}

fn get_24bit(bytes: &[u8], offset: usize) -> u32 {
    ((bytes[offset] as u32) << 16) | ((bytes[offset + 1] as u32) << 8) | (bytes[offset + 2] as u32)
}

fn get_16bit(bytes: &[u8], offset: usize) -> u16 {
    ((bytes[offset] as u16) << 8) | (bytes[offset + 1] as u16)
}

/// Parses one 36-byte `FF 55` frame. Only the fields validated against real
/// captures are decoded (voltage, current, capacity, temperature) - energy
/// (Wh) and the running-state byte didn't line up cleanly with known-good
/// values yet and are deliberately left out rather than guessed.
pub fn parse(bytes: &[u8]) -> Result<Ff55Frame, String> {
    if bytes.len() != 36 {
        return Err(format!("expected 36 bytes, got {}", bytes.len()));
    }
    if bytes[0] != 0xFF || bytes[1] != 0x55 {
        return Err(format!("bad header: {:02X} {:02X}", bytes[0], bytes[1]));
    }

    // Checksum covers the type byte + payload (indices 2..=34), excluding
    // the FF 55 header and the checksum byte itself.
    let sum: u8 = bytes[2..35].iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
    let checksum = sum ^ 0x44;
    if checksum != bytes[35] {
        return Err(format!(
            "checksum mismatch: computed {checksum:02X}, frame has {:02X}",
            bytes[35]
        ));
    }

    Ok(Ff55Frame {
        message_type: bytes[2],
        device_type: bytes[3],
        voltage: get_24bit(bytes, 4) as f64 * 0.1,
        current: get_24bit(bytes, 7) as f64 * 0.001,
        capacity_ah: get_24bit(bytes, 10) as f64 * 0.01,
        temperature_c: get_16bit(bytes, 24) as f64,
    })
}

fn parse_hex_dump(s: &str) -> Result<Vec<u8>, String> {
    s.split_whitespace()
        .map(|tok| u8::from_str_radix(tok, 16).map_err(|e| format!("{tok:?}: {e}")))
        .collect()
}

fn main() {
    let arg = env::args()
        .nth(1)
        .expect("usage: atorch_ff55 \"FF 55 01 02 ...\" (space-separated hex bytes)");
    let bytes = parse_hex_dump(&arg).expect("invalid hex dump");
    match parse(&bytes) {
        Ok(frame) => println!("{frame:#?}"),
        Err(e) => eprintln!("parse error: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // All three frames below were captured verbatim from
    // session-20260708-144932.log as unsolicited bytes preceding a B1B2
    // query - the device's own background broadcast, independent of this
    // app's B1B2 polling.

    #[test]
    fn decodes_idle_frame_matching_known_b1b2_telemetry() {
        // Logged in the same cycle as this app's own decoded telemetry:
        // "V=11.2210 A=0.0000 ... Ah=1.2510 ... tempC=27.00" (session log,
        // 14:49:44) - voltage/capacity/temperature match within rounding.
        let bytes = parse_hex_dump(
            "FF 55 01 02 00 00 70 00 00 00 00 00 7D 00 00 00 01 00 00 00 00 00 00 00 00 1B 00 00 2E 2B 3C 00 00 00 00 E5",
        )
        .unwrap();

        let frame = parse(&bytes).unwrap();

        assert_eq!(frame.message_type, 0x01);
        assert_eq!(frame.device_type, 0x02);
        assert!((frame.voltage - 11.2).abs() < 1e-9);
        assert!((frame.current - 0.0).abs() < 1e-9);
        assert!((frame.capacity_ah - 1.25).abs() < 1e-9);
        assert!((frame.temperature_c - 27.0).abs() < 1e-9);
    }

    #[test]
    fn decodes_frame_captured_while_a_load_was_applied() {
        let bytes = parse_hex_dump(
            "FF 55 01 02 00 00 6E 00 07 C9 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1B 00 00 00 01 3C 00 00 00 00 DD",
        )
        .unwrap();

        let frame = parse(&bytes).unwrap();

        assert!((frame.voltage - 11.0).abs() < 1e-9);
        assert!((frame.current - 1.993).abs() < 1e-9);
    }

    #[test]
    fn capacity_reflects_a_live_reset_counters_action() {
        // Captured immediately after this app's Control Center sent the
        // B1B2 "reset counters" command (0x05). Ah drops to 0 in this
        // independent broadcast stream too, which is the strongest evidence
        // that it reflects the same underlying device state as B1B2 - not a
        // coincidental byte match.
        let bytes = parse_hex_dump(
            "FF 55 01 02 00 00 70 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1B 00 00 00 00 3C 00 00 00 00 8E",
        )
        .unwrap();

        let frame = parse(&bytes).unwrap();

        assert_eq!(frame.capacity_ah, 0.0);
    }

    #[test]
    fn rejects_frame_with_bad_checksum() {
        let mut bytes = parse_hex_dump(
            "FF 55 01 02 00 00 70 00 00 00 00 00 7D 00 00 00 01 00 00 00 00 00 00 00 00 1B 00 00 2E 2B 3C 00 00 00 00 E5",
        )
        .unwrap();
        *bytes.last_mut().unwrap() ^= 0xFF;

        assert!(parse(&bytes).is_err());
    }

    #[test]
    fn rejects_wrong_length() {
        assert!(parse(&[0xFF, 0x55, 0x01]).is_err());
    }
}
