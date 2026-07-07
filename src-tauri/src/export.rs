//! XLSX session export: raw telemetry plus native Excel charts, built with
//! `rust_xlsxwriter`. Kept separate from `commands.rs` since it operates on
//! a full in-memory session handed over from the frontend rather than the
//! live serial worker.

use anyhow::{ensure, Context, Result};
use rust_xlsxwriter::{
    Chart, ChartFormat, ChartLine, ChartMarker, ChartType, Color, ExcelDateTime, Format, Workbook,
};

const SHEET_DATA: &str = "Telemetry";
const SHEET_CHARTS: &str = "Charts";
const DATA_FIRST_ROW: u32 = 1; // header occupies row 0

const COLOR_VOLTAGE: u32 = 0x818CF8;
const COLOR_CURRENT: u32 = 0x34D399;
const COLOR_POWER: u32 = 0xFBBF24;

/// Row count cap to keep an accidental multi-day session from producing an
/// unusably slow Excel file - well past any realistic capacity test.
const MAX_EXPORT_ROWS: usize = 200_000;

/// Builds a workbook with a `Telemetry` data sheet (real timestamp, elapsed
/// seconds, voltage, current, power) and a `Charts` sheet with one
/// scatter-line chart per metric plotted against wall-clock time, and saves
/// it to `path`.
///
/// `timestamps_ms` are Unix epoch milliseconds (i.e. `Date.now()` from the
/// frontend) - the point in time each sample was actually taken, not time
/// elapsed since the session started.
pub fn write_session_xlsx(
    path: &str,
    timestamps_ms: &[f64],
    voltage: &[f64],
    current: &[f64],
    power: &[f64],
) -> Result<()> {
    ensure!(
        timestamps_ms.len() == voltage.len()
            && timestamps_ms.len() == current.len()
            && timestamps_ms.len() == power.len(),
        "mismatched column lengths: time={}, voltage={}, current={}, power={}",
        timestamps_ms.len(),
        voltage.len(),
        current.len(),
        power.len()
    );
    ensure!(!timestamps_ms.is_empty(), "no data to export");

    let mut workbook = Workbook::new();
    write_data_sheet(&mut workbook, timestamps_ms, voltage, current, power)?;
    write_charts_sheet(&mut workbook, timestamps_ms.len() as u32)?;

    workbook
        .save(path)
        .with_context(|| format!("failed to write {path}"))
}

fn write_data_sheet(
    workbook: &mut Workbook,
    timestamps_ms: &[f64],
    voltage: &[f64],
    current: &[f64],
    power: &[f64],
) -> Result<()> {
    let header_format = Format::new().set_bold();
    let timestamp_format = Format::new().set_num_format("yyyy-mm-dd hh:mm:ss");
    let elapsed_format = Format::new().set_num_format("0.000");
    // Rounded for readability - the CSV export is still full precision for
    // anyone who needs it.
    let metric_format = Format::new().set_num_format("0.000");

    let sheet = workbook.add_worksheet().set_name(SHEET_DATA)?;
    sheet.write_row_with_format(
        0,
        0,
        ["Timestamp", "Elapsed (s)", "Voltage (V)", "Current (A)", "Power (W)"],
        &header_format,
    )?;

    let timestamps = timestamps_ms
        .iter()
        .map(|&ms| ExcelDateTime::from_timestamp((ms / 1000.0) as i64))
        .collect::<Result<Vec<_>, _>>()
        .context("sample timestamp out of Excel's representable date range")?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 0, timestamps, &timestamp_format)?;

    let first_ms = timestamps_ms[0];
    let elapsed_s = timestamps_ms.iter().map(|&ms| (ms - first_ms) / 1000.0);
    sheet.write_column_with_format(DATA_FIRST_ROW, 1, elapsed_s, &elapsed_format)?;

    sheet.write_column_with_format(DATA_FIRST_ROW, 2, voltage.iter().copied(), &metric_format)?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 3, current.iter().copied(), &metric_format)?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 4, power.iter().copied(), &metric_format)?;

    for (col, width) in [(0, 20.0), (1, 12.0), (2, 12.0), (3, 12.0), (4, 12.0)] {
        sheet.set_column_width(col, width)?;
    }

    Ok(())
}

/// One scatter-line series, no markers - thousands of points render as a
/// clean line rather than an unreadable cloud of shapes. The X axis reads
/// the `Timestamp` column, so it shows real time-of-day rather than seconds
/// elapsed since the session started.
fn build_metric_chart(row_count: u32, name: &str, unit: &str, value_col: u16, color: u32) -> Chart {
    let last_row = DATA_FIRST_ROW + row_count - 1;
    let mut chart = Chart::new(ChartType::ScatterStraight);

    chart
        .add_series()
        .set_name(name)
        .set_categories((SHEET_DATA, DATA_FIRST_ROW, 0, last_row, 0))
        .set_values((SHEET_DATA, DATA_FIRST_ROW, value_col, last_row, value_col))
        .set_format(ChartFormat::new().set_line(ChartLine::new().set_color(Color::RGB(color)).set_width(1.5)))
        .set_marker(ChartMarker::new().set_none());

    chart.title().set_name(name);
    chart.x_axis().set_name("Time").set_num_format("hh:mm:ss");
    chart.y_axis().set_name(unit);
    chart.set_width(720).set_height(380);
    chart.legend().set_hidden();

    chart
}

fn write_charts_sheet(workbook: &mut Workbook, row_count: u32) -> Result<()> {
    let voltage_chart = build_metric_chart(row_count, "Voltage", "V", 2, COLOR_VOLTAGE);
    let current_chart = build_metric_chart(row_count, "Current", "A", 3, COLOR_CURRENT);
    let power_chart = build_metric_chart(row_count, "Power", "W", 4, COLOR_POWER);

    let sheet = workbook.add_worksheet().set_name(SHEET_CHARTS)?;
    // Charts are ~380px (~20 rows at default row height) tall; 21-row steps
    // keep them from overlapping.
    sheet.insert_chart(0, 0, &voltage_chart)?;
    sheet.insert_chart(21, 0, &current_chart)?;
    sheet.insert_chart(42, 0, &power_chart)?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn export_xlsx(
    path: String,
    timestamps_ms: Vec<f64>,
    voltage: Vec<f64>,
    current: Vec<f64>,
    power: Vec<f64>,
) -> Result<(), String> {
    if timestamps_ms.len() > MAX_EXPORT_ROWS {
        return Err(format!(
            "Session too large to export ({} points, max {MAX_EXPORT_ROWS})",
            timestamps_ms.len()
        ));
    }
    write_session_xlsx(&path, &timestamps_ms, &voltage, &current, &power).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TempXlsx(std::path::PathBuf);

    impl TempXlsx {
        fn new(name: &str) -> Self {
            let mut path = std::env::temp_dir();
            path.push(format!("tauri-app-export-test-{name}-{:?}.xlsx", std::thread::current().id()));
            Self(path)
        }
    }

    impl Drop for TempXlsx {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    // A realistic epoch-ms timestamp (2024-01-01T00:00:00Z) so
    // ExcelDateTime::from_timestamp accepts it.
    const BASE_MS: f64 = 1_704_067_200_000.0;

    #[test]
    fn write_session_xlsx_produces_a_valid_zip_package() {
        let file = TempXlsx::new("valid");
        let timestamps = [BASE_MS, BASE_MS + 1500.0, BASE_MS + 3000.0];
        let voltage = [4.2, 4.1, 4.0];
        let current = [1.0, 1.0, 1.0];
        let power = [4.2, 4.1, 4.0];

        write_session_xlsx(file.0.to_str().unwrap(), &timestamps, &voltage, &current, &power).unwrap();

        // .xlsx is a zip package - it must start with the local file header
        // signature "PK\x03\x04" and be non-trivially sized.
        let bytes = fs::read(&file.0).unwrap();
        assert_eq!(&bytes[..4], b"PK\x03\x04");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn write_session_xlsx_rejects_mismatched_column_lengths() {
        let file = TempXlsx::new("mismatched");
        let err =
            write_session_xlsx(file.0.to_str().unwrap(), &[BASE_MS, BASE_MS + 1000.0], &[4.2], &[1.0], &[4.2])
                .unwrap_err();
        assert!(err.to_string().contains("mismatched column lengths"));
    }

    #[test]
    fn write_session_xlsx_rejects_empty_data() {
        let file = TempXlsx::new("empty");
        let err = write_session_xlsx(file.0.to_str().unwrap(), &[], &[], &[], &[]).unwrap_err();
        assert!(err.to_string().contains("no data"));
    }

    #[test]
    fn export_xlsx_command_rejects_oversized_sessions() {
        let file = TempXlsx::new("oversized");
        let n = MAX_EXPORT_ROWS + 1;
        let result = export_xlsx(
            file.0.to_str().unwrap().to_string(),
            vec![BASE_MS; n],
            vec![0.0; n],
            vec![0.0; n],
            vec![0.0; n],
        );
        assert!(result.is_err());
    }
}
