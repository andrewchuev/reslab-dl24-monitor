//! Low-level serial I/O for the PX-100 protocol: framing, retries and response parsing.

use crate::protocol::{
    self, Val, ACK, AUX_VALS, FREQ_VALS, HEADER, RESPONSE_HEADER, RESPONSE_TRAILER, TRAILER,
};
use anyhow::{anyhow, Result};
use serialport::SerialPort;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

pub const BAUD: u32 = 9600;

pub const COMMAND_TIMEOUT_MS: u64 = 1200;
const BUFFER_CLEAR_TIMEOUT_MS: u64 = 40;
const COMMAND_RETRY_DELAY_MS: u64 = 200;
const VALUE_READ_RETRIES: u8 = 3;
/// Granularity for checking the stop flag while waiting, so a disconnect
/// request is noticed quickly instead of only between poll cycles.
const STOP_CHECK_INTERVAL_MS: u64 = 100;

/// Sleeps for `duration_ms`, but wakes early and returns as soon as `stop` is set.
pub fn interruptible_sleep(stop: &AtomicBool, duration_ms: u64) {
    let mut remaining = duration_ms;
    while remaining > 0 && !stop.load(Ordering::Relaxed) {
        let chunk = remaining.min(STOP_CHECK_INTERVAL_MS);
        thread::sleep(Duration::from_millis(chunk));
        remaining -= chunk;
    }
}

#[derive(Default)]
pub struct DataStore {
    pub is_on: f64,
    pub voltage: f64,
    pub current: f64,
    pub time: String,
    pub cap_ah: f64,
    pub cap_wh: f64,
    pub temp: f64,
    pub set_current: f64,
    pub set_voltage: f64,
    pub set_timer: String,
}

/// Formats bytes as space-separated uppercase hex, e.g. `[0xB1, 0x02]` -> `"B1 02"`.
/// Used to log raw wire traffic for protocol/transport diagnostics (e.g.
/// comparing SPP vs. BLE framing on the same hardware).
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

pub fn clear_buffer(port: &mut dyn SerialPort) -> Result<()> {
    // Rough equivalent of a flush+read loop:
    // set a very small timeout and keep reading until nothing is left.
    if let Err(e) = port.flush() {
        log::debug!("clear_buffer: flush failed: {e}");
    }
    port.set_timeout(Duration::from_millis(BUFFER_CLEAR_TIMEOUT_MS))?;

    let mut tmp = [0u8; 256];
    loop {
        match port.read(&mut tmp) {
            Ok(n) if n > 0 => {
                log::debug!("RX (discarded stale, {n}B): {}", hex(&tmp[..n]));
            }
            _ => break,
        }
    }
    port.set_timeout(Duration::from_millis(COMMAND_TIMEOUT_MS))?;
    Ok(())
}

pub fn send_command(
    port: &mut dyn SerialPort,
    command: u8,
    d1: u8,
    d2: u8,
    stop: &AtomicBool,
) -> Result<Vec<u8>> {
    let frame = [HEADER[0], HEADER[1], command, d1, d2, TRAILER];
    log::debug!("TX: {}", hex(&frame));
    port.write_all(&frame)?;
    port.flush()?;

    let expected_header: Vec<u8> = if command >= 0x10 {
        RESPONSE_HEADER.to_vec()
    } else {
        vec![ACK]
    };
    let expected_len: usize = if command >= 0x10 { 7 } else { 1 };

    let deadline = Instant::now() + Duration::from_millis(COMMAND_TIMEOUT_MS);
    let mut buffer: Vec<u8> = Vec::with_capacity(64);
    let mut chunk = [0u8; 256];

    while Instant::now() < deadline {
        if stop.load(Ordering::Relaxed) {
            return Err(anyhow!("Cancelled"));
        }
        match port.read(&mut chunk) {
            Ok(n) if n > 0 => {
                log::debug!("RX: {}", hex(&chunk[..n]));
                buffer.extend_from_slice(&chunk[..n]);

                // Loops (instead of checking once) so a false header match
                // that's immediately followed by a real frame - already
                // fully buffered from this same read - gets found right
                // away, rather than only being noticed once more bytes
                // happen to arrive on a later read().
                while let Some(start) = protocol::find_subslice(&buffer, &expected_header) {
                    if buffer.len().saturating_sub(start) < expected_len {
                        break; // not enough bytes yet for this candidate
                    }
                    let packet = buffer[start..start + expected_len].to_vec();

                    if command >= 0x10 {
                        if packet.len() >= 7
                            && packet[5] == RESPONSE_TRAILER[0]
                            && packet[6] == RESPONSE_TRAILER[1]
                        {
                            return Ok(packet);
                        }
                        // Header matched by chance inside unrelated bytes
                        // (trailer two bytes later doesn't line up). Drop it
                        // so the next scan can't re-match this same false
                        // start forever - without this, a buffer that never
                        // finds a real frame keeps re-checking the same
                        // spurious header on every loop iteration, and a
                        // lucky trailer match later would decode garbage as
                        // a "valid" reading.
                        buffer.drain(..=start);
                    } else {
                        return Ok(packet);
                    }
                }
            }
            _ => {
                // keep looping until deadline
            }
        }
    }

    Err(anyhow!("Timeout reading response"))
}

pub fn get_val(
    port: &mut dyn SerialPort,
    command: u8,
    retries: u8,
    stop: &AtomicBool,
) -> Result<Option<Val>> {
    for _attempt in 0..retries {
        if stop.load(Ordering::Relaxed) {
            return Ok(None);
        }
        if let Err(e) = clear_buffer(port) {
            log::debug!("get_val(cmd={command:#04x}): clear_buffer failed: {e}");
        }

        match send_command(port, command, 0, 0, stop) {
            Ok(resp) => {
                if resp.len() == 1 && resp[0] == ACK {
                    continue;
                }
                if resp.len() < 7 {
                    continue;
                }

                let d1 = resp[2];
                let d2 = resp[3];
                let d3 = resp[4];

                if command == protocol::TIME_CMD || command == protocol::TIMER {
                    let (hh, mm, ss) = (d1, d2, d3);
                    if hh > 99 || mm > 59 || ss > 59 {
                        continue;
                    }
                    return Ok(Some(Val::Time(format!("{hh:02}:{mm:02}:{ss:02}"))));
                } else {
                    let raw: u32 = ((d1 as u32) << 16) | ((d2 as u32) << 8) | (d3 as u32);
                    let v = (raw as f64) / protocol::mul(command);
                    if !protocol::is_plausible_reading(command, v) {
                        log::warn!(
                            "get_val(cmd={command:#04x}): rejected implausible reading {v} (likely framing corruption), retrying"
                        );
                        continue;
                    }
                    return Ok(Some(Val::Num(v)));
                }
            }
            Err(e) => {
                log::debug!("get_val(cmd={command:#04x}): {e}");
                interruptible_sleep(stop, COMMAND_RETRY_DELAY_MS);
                continue;
            }
        }
    }

    Ok(None)
}

fn cmd_to_key_update(ds: &mut DataStore, cmd: u8, val: Val) {
    match (cmd, val) {
        (protocol::ISON, Val::Num(v)) => ds.is_on = v,
        (protocol::VOLTAGE, Val::Num(v)) => ds.voltage = v,
        (protocol::CURRENT, Val::Num(v)) => ds.current = v,
        (protocol::CAP_AH, Val::Num(v)) => ds.cap_ah = v,
        (protocol::CAP_WH, Val::Num(v)) => ds.cap_wh = v,
        (protocol::TEMP, Val::Num(v)) => ds.temp = v,
        (protocol::LIM_CURR, Val::Num(v)) => ds.set_current = v,
        (protocol::LIM_VOLT, Val::Num(v)) => ds.set_voltage = v,
        (protocol::TIME_CMD, Val::Time(t)) => ds.time = t,
        (protocol::TIMER, Val::Time(t)) => ds.set_timer = t,
        _ => {}
    }
}

/// Polls one cycle's worth of values. Returns how many of `FREQ_VALS` were
/// successfully read - the caller uses this to tell a live link with an
/// occasional dropped value from one that's gone completely silent (e.g. the
/// USB-serial adapter was unplugged), which a bare `Ok(())` couldn't convey.
pub fn read_all(
    port: &mut dyn SerialPort,
    ds: &mut DataStore,
    aux_index: &mut usize,
    read_all_aux: bool,
    stop: &AtomicBool,
) -> Result<usize> {
    let mut read_count = 0;
    for &cmd in &FREQ_VALS {
        if stop.load(Ordering::Relaxed) {
            return Ok(read_count);
        }
        if let Some(v) = get_val(port, cmd, VALUE_READ_RETRIES, stop)? {
            cmd_to_key_update(ds, cmd, v);
            read_count += 1;
        }
    }

    if read_all_aux {
        for &cmd in &AUX_VALS {
            if stop.load(Ordering::Relaxed) {
                return Ok(read_count);
            }
            if let Some(v) = get_val(port, cmd, VALUE_READ_RETRIES, stop)? {
                cmd_to_key_update(ds, cmd, v);
            }
        }
    } else {
        let cmd = AUX_VALS[*aux_index];
        if let Some(v) = get_val(port, cmd, VALUE_READ_RETRIES, stop)? {
            cmd_to_key_update(ds, cmd, v);
        }
        *aux_index = (*aux_index + 1) % AUX_VALS.len();
    }

    Ok(read_count)
}

/// Sends a write command (cmd < 0x10) and retries until the device ACKs it.
fn write_command(port: &mut dyn SerialPort, cmd: u8, d1: u8, d2: u8, stop: &AtomicBool) -> Result<()> {
    for _attempt in 0..VALUE_READ_RETRIES {
        if stop.load(Ordering::Relaxed) {
            return Err(anyhow!("Cancelled"));
        }
        match send_command(port, cmd, d1, d2, stop) {
            Ok(resp) if resp.len() == 1 && resp[0] == ACK => return Ok(()),
            Ok(_) => continue,
            Err(e) => {
                log::debug!("write_command(cmd={cmd:#04x}): {e}");
                interruptible_sleep(stop, COMMAND_RETRY_DELAY_MS);
                continue;
            }
        }
    }
    Err(anyhow!("Device did not acknowledge command {cmd:#04x}"))
}

pub fn set_onoff(port: &mut dyn SerialPort, on: bool, stop: &AtomicBool) -> Result<()> {
    write_command(port, protocol::CMD_ONOFF, on as u8, 0, stop)
}

pub fn set_current(port: &mut dyn SerialPort, amps: f64, stop: &AtomicBool) -> Result<()> {
    let (int_part, frac_part) = protocol::float_to_int_frac(amps);
    write_command(port, protocol::CMD_SETCURRENT, int_part, frac_part, stop)
}

pub fn set_cutoff(port: &mut dyn SerialPort, volts: f64, stop: &AtomicBool) -> Result<()> {
    let (int_part, frac_part) = protocol::float_to_int_frac(volts);
    write_command(port, protocol::CMD_SETCUTOFF, int_part, frac_part, stop)
}

pub fn set_timeout(port: &mut dyn SerialPort, seconds: u32, stop: &AtomicBool) -> Result<()> {
    let secs = seconds.min(u16::MAX as u32) as u16;
    write_command(port, protocol::CMD_SETTIMEOUT, (secs >> 8) as u8, (secs & 0xFF) as u8, stop)
}

pub fn reset_counters(port: &mut dyn SerialPort, stop: &AtomicBool) -> Result<()> {
    write_command(port, protocol::CMD_RESET, 0, 0, stop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serialport::{ClearBuffer, DataBits, Error as SpError, ErrorKind, FlowControl, Parity, StopBits};
    use std::collections::VecDeque;
    use std::io::{self, Read, Write};

    /// In-memory stand-in for a physical serial port. `pending_response` only
    /// becomes readable once `write` is called, mirroring a real device that
    /// replies to a request rather than having data sitting in the buffer
    /// beforehand (which `clear_buffer` would otherwise discard as stale).
    struct MockPort {
        input: VecDeque<u8>,
        pending_response: VecDeque<u8>,
        written: Vec<u8>,
    }

    impl MockPort {
        fn with_response(bytes: &[u8]) -> Self {
            Self {
                input: VecDeque::new(),
                pending_response: bytes.iter().copied().collect(),
                written: Vec::new(),
            }
        }

        fn silent() -> Self {
            Self::with_response(&[])
        }
    }

    impl Read for MockPort {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = buf.len().min(self.input.len());
            for slot in buf.iter_mut().take(n) {
                *slot = self.input.pop_front().unwrap();
            }
            Ok(n)
        }
    }

    impl Write for MockPort {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.written.extend_from_slice(buf);
            self.input.extend(self.pending_response.drain(..));
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl SerialPort for MockPort {
        fn name(&self) -> Option<String> {
            None
        }
        fn baud_rate(&self) -> serialport::Result<u32> {
            Ok(BAUD)
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
            Duration::from_millis(COMMAND_TIMEOUT_MS)
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
        fn set_timeout(&mut self, _: Duration) -> serialport::Result<()> {
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
            Ok(self.input.len() as u32)
        }
        fn bytes_to_write(&self) -> serialport::Result<u32> {
            Ok(0)
        }
        fn clear(&self, _: ClearBuffer) -> serialport::Result<()> {
            Ok(())
        }
        fn try_clone(&self) -> serialport::Result<Box<dyn SerialPort>> {
            Err(SpError::new(ErrorKind::Unknown, "clone not supported in tests"))
        }
        fn set_break(&self) -> serialport::Result<()> {
            Ok(())
        }
        fn clear_break(&self) -> serialport::Result<()> {
            Ok(())
        }
    }

    fn response_packet(d1: u8, d2: u8, d3: u8) -> [u8; 7] {
        [
            RESPONSE_HEADER[0],
            RESPONSE_HEADER[1],
            d1,
            d2,
            d3,
            RESPONSE_TRAILER[0],
            RESPONSE_TRAILER[1],
        ]
    }

    #[test]
    fn send_command_writes_a_correctly_framed_request() {
        let mut port = MockPort::with_response(&response_packet(0, 0x30, 0x39));
        let stop = AtomicBool::new(false);

        send_command(&mut port, protocol::VOLTAGE, 0, 0, &stop).unwrap();

        assert_eq!(
            port.written,
            vec![HEADER[0], HEADER[1], protocol::VOLTAGE, 0, 0, TRAILER]
        );
    }

    #[test]
    fn send_command_parses_a_valid_response() {
        let mut port = MockPort::with_response(&response_packet(0, 0x30, 0x39));
        let stop = AtomicBool::new(false);

        let packet = send_command(&mut port, protocol::VOLTAGE, 0, 0, &stop).unwrap();

        assert_eq!(packet, response_packet(0, 0x30, 0x39));
    }

    #[test]
    fn send_command_recovers_from_a_stray_header_match() {
        // A CA-CB pair that shows up by chance inside unrelated bytes, whose
        // trailer doesn't line up, immediately followed by a real frame -
        // both delivered in the same read. Must not be timed out or return
        // the garbage frame.
        let false_header_with_wrong_trailer = [RESPONSE_HEADER[0], RESPONSE_HEADER[1], 0x11, 0x22, 0x33, 0x44, 0x55];
        let real_frame = response_packet(0, 0x30, 0x39);
        let mut response = Vec::new();
        response.extend_from_slice(&false_header_with_wrong_trailer);
        response.extend_from_slice(&real_frame);

        let mut port = MockPort::with_response(&response);
        let stop = AtomicBool::new(false);

        let packet = send_command(&mut port, protocol::VOLTAGE, 0, 0, &stop).unwrap();

        assert_eq!(packet, real_frame);
    }

    #[test]
    fn send_command_times_out_when_device_never_responds() {
        let mut port = MockPort::silent();
        let stop = AtomicBool::new(false);

        assert!(send_command(&mut port, protocol::VOLTAGE, 0, 0, &stop).is_err());
    }

    #[test]
    fn send_command_bails_out_immediately_when_stopped() {
        let mut port = MockPort::silent();
        let stop = AtomicBool::new(true);

        let started = Instant::now();
        assert!(send_command(&mut port, protocol::VOLTAGE, 0, 0, &stop).is_err());
        assert!(
            started.elapsed() < Duration::from_millis(COMMAND_TIMEOUT_MS / 2),
            "should not wait for the full command timeout once stopped"
        );
    }

    #[test]
    fn get_val_decodes_a_24_bit_scaled_reading() {
        // 0x003039 = 12345 raw -> 12.345 V after the x1000 VOLTAGE scale factor.
        let mut port = MockPort::with_response(&response_packet(0x00, 0x30, 0x39));
        let stop = AtomicBool::new(false);

        let val = get_val(&mut port, protocol::VOLTAGE, VALUE_READ_RETRIES, &stop).unwrap();
        match val {
            Some(Val::Num(v)) => assert!((v - 12.345).abs() < 1e-9),
            other => panic!("expected Val::Num(12.345), got {other:?}"),
        }
    }

    #[test]
    fn get_val_decodes_a_time_field() {
        let mut port = MockPort::with_response(&response_packet(1, 2, 3));
        let stop = AtomicBool::new(false);

        let val = get_val(&mut port, protocol::TIME_CMD, VALUE_READ_RETRIES, &stop).unwrap();
        match val {
            Some(Val::Time(t)) => assert_eq!(t, "01:02:03"),
            other => panic!("expected Val::Time, got {other:?}"),
        }
    }

    #[test]
    fn set_onoff_sends_correct_frame_and_succeeds_on_ack() {
        let mut port = MockPort::with_response(&[ACK]);
        let stop = AtomicBool::new(false);

        set_onoff(&mut port, true, &stop).unwrap();

        assert_eq!(
            port.written,
            vec![HEADER[0], HEADER[1], protocol::CMD_ONOFF, 1, 0, TRAILER]
        );
    }

    #[test]
    fn set_current_encodes_integer_and_fraction_bytes() {
        let mut port = MockPort::with_response(&[ACK]);
        let stop = AtomicBool::new(false);

        set_current(&mut port, 2.5, &stop).unwrap();

        assert_eq!(
            port.written,
            vec![HEADER[0], HEADER[1], protocol::CMD_SETCURRENT, 2, 50, TRAILER]
        );
    }

    #[test]
    fn write_command_does_not_report_success_on_a_non_ack_reply() {
        // A single stray byte that isn't the ACK must not be mistaken for one.
        let mut port = MockPort::with_response(&[0x00]);
        let stop = AtomicBool::new(false);

        assert!(set_onoff(&mut port, false, &stop).is_err());
    }
}
