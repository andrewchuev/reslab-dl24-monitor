//! PX-100 electronic load serial protocol: frame layout, commands and value decoding.
//! Reference: https://github.com/misdoro/Electronic_load_px100/blob/master/protocol_PX-100_2_70.md

pub const HEADER: [u8; 2] = [0xB1, 0xB2];
pub const TRAILER: u8 = 0xB6;
pub const RESPONSE_HEADER: [u8; 2] = [0xCA, 0xCB];
pub const RESPONSE_TRAILER: [u8; 2] = [0xCE, 0xCF];
pub const ACK: u8 = 0x6F;

// Write commands (<0x10), device replies with a single ACK byte
pub const CMD_ONOFF: u8 = 0x01;
pub const CMD_SETCURRENT: u8 = 0x02;
pub const CMD_SETCUTOFF: u8 = 0x03;
pub const CMD_SETTIMEOUT: u8 = 0x04;
pub const CMD_RESET: u8 = 0x05;

// Query commands (0x1*)
pub const ISON: u8 = 0x10;
pub const VOLTAGE: u8 = 0x11;
pub const CURRENT: u8 = 0x12;
pub const TIME_CMD: u8 = 0x13;
pub const CAP_AH: u8 = 0x14;
pub const CAP_WH: u8 = 0x15;
pub const TEMP: u8 = 0x16;
pub const LIM_CURR: u8 = 0x17;
pub const LIM_VOLT: u8 = 0x18;
pub const TIMER: u8 = 0x19;

/// Polled every cycle.
pub const FREQ_VALS: [u8; 5] = [ISON, VOLTAGE, CURRENT, TIME_CMD, CAP_AH];
/// Polled one-at-a-time, round-robin, to keep the poll cycle short.
pub const AUX_VALS: [u8; 5] = [CAP_WH, TEMP, LIM_CURR, LIM_VOLT, TIMER];

#[derive(Debug)]
pub enum Val {
    Num(f64),
    Time(String),
}

/// Scale factor to convert a raw 24-bit protocol value into its physical unit.
pub fn mul(cmd: u8) -> f64 {
    match cmd {
        ISON => 1.0,
        VOLTAGE | CURRENT | CAP_AH | CAP_WH => 1000.0,
        TEMP => 1.0,
        LIM_CURR | LIM_VOLT => 100.0,
        _ => 1000.0,
    }
}

/// Parses a "HH:MM:SS" duration string into total seconds.
/// u32 is plenty (max HH:99 -> ~136 years) and, unlike u64, exports safely to a TS `number`.
pub fn runtime_seconds(time: &str) -> u32 {
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() != 3 {
        return 0;
    }
    let hh = parts[0].parse::<u32>().unwrap_or(0);
    let mm = parts[1].parse::<u32>().unwrap_or(0);
    let ss = parts[2].parse::<u32>().unwrap_or(0);
    hh * 3600 + mm * 60 + ss
}

pub fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Rejects decoded values so far outside any plausible physical range that
/// they can only be framing corruption - e.g. a stray header/trailer byte
/// pair that matched by chance inside unrelated bytes, decoding garbage as
/// a "valid" 24-bit reading. Callers retry on rejection, same as any other
/// failed read, instead of feeding a spike straight to the UI.
pub fn is_plausible_reading(cmd: u8, value: f64) -> bool {
    if !value.is_finite() {
        return false;
    }
    match cmd {
        ISON => (0.0..=1.0).contains(&value),
        VOLTAGE | LIM_VOLT => (0.0..=200.0).contains(&value),
        CURRENT | LIM_CURR => (0.0..=50.0).contains(&value),
        CAP_AH => (0.0..=100.0).contains(&value),
        CAP_WH => (0.0..=5000.0).contains(&value),
        TEMP => (-40.0..=150.0).contains(&value),
        _ => true,
    }
}

/// Whether `new` is a big enough jump from `previous` (the last accepted
/// reading for this same field) to be worth an extra confirmation read
/// before trusting it. `None` for `previous` (no history yet, e.g. right
/// after connecting) never flags anything - there's nothing to compare.
///
/// This is deliberately looser than `is_plausible_reading`: a jump this
/// size sometimes IS real (toggling the load, a counters reset, a new
/// setpoint), so it doesn't reject the value outright. It only asks
/// `get_val`'s retry loop to see the same jump twice in a row before
/// accepting it - a stale/misrouted response from a different command
/// landing in this slot (see the `send_command` docs) won't repeat
/// identically on the very next read, but a genuine change will.
pub fn is_suspicious_jump(cmd: u8, previous: Option<f64>, new: f64) -> bool {
    let Some(previous) = previous else { return false };
    match cmd {
        VOLTAGE | CURRENT | LIM_CURR | LIM_VOLT | CAP_AH | CAP_WH | TEMP => {
            let delta = (new - previous).abs();
            delta > previous.abs() * 0.3 + 0.2
        }
        _ => false,
    }
}

/// Encodes a value as the protocol's (integer, 2-digit fraction) byte pair, e.g. `2.5 -> (2, 50)`.
/// Used for set-current/set-cutoff commands. Negative input clamps to 0; out-of-byte-range
/// magnitudes clamp rather than wrap, since silently sending a wrapped value to the device
/// would be worse than clamping to its nearest representable one.
pub fn float_to_int_frac(value: f64) -> (u8, u8) {
    let clamped = value.max(0.0);
    let int_part = clamped.trunc().min(u8::MAX as f64) as u8;
    let frac_part = (clamped.fract() * 100.0).round().min(99.0) as u8;
    (int_part, frac_part)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_seconds_parses_hh_mm_ss() {
        assert_eq!(runtime_seconds("01:02:03"), 3723);
        assert_eq!(runtime_seconds("00:00:00"), 0);
    }

    #[test]
    fn runtime_seconds_rejects_malformed_input() {
        assert_eq!(runtime_seconds(""), 0);
        assert_eq!(runtime_seconds("12:34"), 0);
        assert_eq!(runtime_seconds("aa:bb:cc"), 0);
    }

    #[test]
    fn find_subslice_locates_needle() {
        let haystack = [0x01, 0xCA, 0xCB, 0x02, 0x03];
        assert_eq!(find_subslice(&haystack, &RESPONSE_HEADER), Some(1));
        assert_eq!(find_subslice(&haystack, &[0xFF]), None);
        assert_eq!(find_subslice(&haystack, &[]), Some(0));
    }

    #[test]
    fn mul_matches_protocol_scale_factors() {
        assert_eq!(mul(ISON), 1.0);
        assert_eq!(mul(VOLTAGE), 1000.0);
        assert_eq!(mul(LIM_CURR), 100.0);
        assert_eq!(mul(TEMP), 1.0);
    }

    #[test]
    fn float_to_int_frac_encodes_integer_and_two_digit_fraction() {
        assert_eq!(float_to_int_frac(2.5), (2, 50));
        assert_eq!(float_to_int_frac(0.0), (0, 0));
        assert_eq!(float_to_int_frac(12.34), (12, 34));
    }

    #[test]
    fn float_to_int_frac_clamps_out_of_range_input() {
        assert_eq!(float_to_int_frac(-5.0), (0, 0));
        assert_eq!(float_to_int_frac(300.0), (255, 0));
    }

    #[test]
    fn is_plausible_reading_accepts_realistic_values() {
        assert!(is_plausible_reading(VOLTAGE, 19.68));
        assert!(is_plausible_reading(CURRENT, 0.997));
        assert!(is_plausible_reading(TEMP, 30.0));
        assert!(is_plausible_reading(ISON, 1.0));
    }

    #[test]
    fn is_plausible_reading_rejects_framing_garbage() {
        // Values in this ballpark are exactly what a stray CA-CB match inside
        // unrelated bytes decodes to - nowhere near a real load's range.
        assert!(!is_plausible_reading(VOLTAGE, 44019.0));
        assert!(!is_plausible_reading(CURRENT, 271771.0));
        assert!(!is_plausible_reading(VOLTAGE, f64::NAN));
        assert!(!is_plausible_reading(VOLTAGE, -1.0));
    }

    #[test]
    fn is_suspicious_jump_ignores_normal_ripple() {
        assert!(!is_suspicious_jump(VOLTAGE, Some(19.35), 19.36));
        assert!(!is_suspicious_jump(CURRENT, Some(3.001), 2.995));
    }

    #[test]
    fn is_suspicious_jump_has_no_baseline_on_the_first_read() {
        assert!(!is_suspicious_jump(VOLTAGE, None, 0.001));
    }

    #[test]
    fn is_suspicious_jump_flags_reproduced_field_swap_glitches() {
        // Taken from a real session log: voltage's own reading (~19.35V)
        // showed up in current's slot, and the trailing dummy frame after
        // the device's own broadcast decoded as a near-zero voltage.
        assert!(is_suspicious_jump(CURRENT, Some(3.0), 19.361));
        assert!(is_suspicious_jump(VOLTAGE, Some(19.35), 0.001));
        assert!(is_suspicious_jump(LIM_VOLT, Some(8.0), 0.01));
    }

    #[test]
    fn is_suspicious_jump_ignores_metrics_without_a_meaningful_history_check() {
        assert!(!is_suspicious_jump(ISON, Some(1.0), 0.0));
    }
}
