//! Session log file naming: a fresh timestamped file per app launch, so
//! comparing what happened across two runs doesn't require untangling one
//! ever-growing log.

/// Formats the current UTC time as `session-YYYYMMDD-HHMMSS`, used as the
/// log file name for this run.
pub fn session_log_file_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let (y, mo, d, h, mi, s) = civil_from_unix_secs(now.as_secs());
    format!("session-{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

/// Splits Unix seconds into UTC (year, month, day, hour, minute, second).
/// Date part uses Howard Hinnant's `civil_from_days` algorithm
/// (<http://howardhinnant.github.io/date_algorithms.html>), proleptic
/// Gregorian - avoids pulling in a full date/time crate for a log filename.
fn civil_from_unix_secs(total_secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (total_secs / 86400) as i64;
    let secs_of_day = total_secs % 86400;
    let (h, mi, s) = (
        (secs_of_day / 3600) as u32,
        ((secs_of_day % 3600) / 60) as u32,
        (secs_of_day % 60) as u32,
    );

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };

    (year, m, d, h, mi, s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_from_unix_secs_matches_known_dates() {
        assert_eq!(civil_from_unix_secs(0), (1970, 1, 1, 0, 0, 0));
        // 2000-01-01 00:00:00 UTC is 10957 days after the epoch.
        assert_eq!(civil_from_unix_secs(10957 * 86400), (2000, 1, 1, 0, 0, 0));
        assert_eq!(civil_from_unix_secs(1783374930), (2026, 7, 6, 21, 55, 30));
    }

    #[test]
    fn session_log_file_name_has_the_expected_shape() {
        let name = session_log_file_name();
        assert!(name.starts_with("session-"));
        assert_eq!(name.len(), "session-YYYYMMDD-HHMMSS".len());
    }
}
