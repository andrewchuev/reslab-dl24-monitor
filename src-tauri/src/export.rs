//! XLSX session export: raw telemetry plus native Excel charts, built with
//! `rust_xlsxwriter`. Kept separate from `commands.rs` since it operates on
//! a full in-memory session handed over from the frontend rather than the
//! live serial worker.

use anyhow::{ensure, Context, Result};
use rust_xlsxwriter::{
    Chart, ChartFormat, ChartLine, ChartMarker, ChartType, Color, Format, Workbook,
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

/// Builds a workbook with a `Telemetry` data sheet (time, elapsed duration,
/// voltage, current, power) and a `Charts` sheet with one scatter-line chart
/// per metric plotted against elapsed seconds, and saves it to `path`.
pub fn write_session_xlsx(
    path: &str,
    times: &[f64],
    voltage: &[f64],
    current: &[f64],
    power: &[f64],
) -> Result<()> {
    ensure!(
        times.len() == voltage.len() && times.len() == current.len() && times.len() == power.len(),
        "mismatched column lengths: time={}, voltage={}, current={}, power={}",
        times.len(),
        voltage.len(),
        current.len(),
        power.len()
    );
    ensure!(!times.is_empty(), "no data to export");

    let mut workbook = Workbook::new();
    write_data_sheet(&mut workbook, times, voltage, current, power)?;
    write_charts_sheet(&mut workbook, times.len() as u32)?;

    workbook
        .save(path)
        .with_context(|| format!("failed to write {path}"))
}

fn write_data_sheet(
    workbook: &mut Workbook,
    times: &[f64],
    voltage: &[f64],
    current: &[f64],
    power: &[f64],
) -> Result<()> {
    let header_format = Format::new().set_bold();
    let seconds_format = Format::new().set_num_format("0.000");
    let duration_format = Format::new().set_num_format("[h]:mm:ss");
    let metric_format = Format::new().set_num_format("0.000000");

    let sheet = workbook.add_worksheet().set_name(SHEET_DATA)?;
    sheet.write_row_with_format(
        0,
        0,
        ["Time (s)", "Elapsed", "Voltage (V)", "Current (A)", "Power (W)"],
        &header_format,
    )?;

    sheet.write_column_with_format(DATA_FIRST_ROW, 0, times.iter().copied(), &seconds_format)?;
    sheet.write_column_with_format(
        DATA_FIRST_ROW,
        1,
        times.iter().map(|t| t / 86_400.0),
        &duration_format,
    )?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 2, voltage.iter().copied(), &metric_format)?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 3, current.iter().copied(), &metric_format)?;
    sheet.write_column_with_format(DATA_FIRST_ROW, 4, power.iter().copied(), &metric_format)?;

    for (col, width) in [(0, 12.0), (1, 12.0), (2, 12.0), (3, 12.0), (4, 12.0)] {
        sheet.set_column_width(col, width)?;
    }

    Ok(())
}

/// One scatter-line series, no markers - thousands of points render as a
/// clean line rather than an unreadable cloud of shapes.
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
    chart.x_axis().set_name("Time (s)");
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
    times: Vec<f64>,
    voltage: Vec<f64>,
    current: Vec<f64>,
    power: Vec<f64>,
) -> Result<(), String> {
    if times.len() > MAX_EXPORT_ROWS {
        return Err(format!(
            "Session too large to export ({} points, max {MAX_EXPORT_ROWS})",
            times.len()
        ));
    }
    write_session_xlsx(&path, &times, &voltage, &current, &power).map_err(|e| e.to_string())
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

    #[test]
    fn write_session_xlsx_produces_a_valid_zip_package() {
        let file = TempXlsx::new("valid");
        let times = [0.0, 1.5, 3.0];
        let voltage = [4.2, 4.1, 4.0];
        let current = [1.0, 1.0, 1.0];
        let power = [4.2, 4.1, 4.0];

        write_session_xlsx(file.0.to_str().unwrap(), &times, &voltage, &current, &power).unwrap();

        // .xlsx is a zip package - it must start with the local file header
        // signature "PK\x03\x04" and be non-trivially sized.
        let bytes = fs::read(&file.0).unwrap();
        assert_eq!(&bytes[..4], b"PK\x03\x04");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn write_session_xlsx_rejects_mismatched_column_lengths() {
        let file = TempXlsx::new("mismatched");
        let err = write_session_xlsx(file.0.to_str().unwrap(), &[0.0, 1.0], &[4.2], &[1.0], &[4.2]).unwrap_err();
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
            vec![0.0; n],
            vec![0.0; n],
            vec![0.0; n],
            vec![0.0; n],
        );
        assert!(result.is_err());
    }
}
