mod ble;
mod ble_test;
mod commands;
mod export;
mod logging;
mod protocol;
mod serial;
mod state;

use commands::{ConnectionStatusEvent, DeviceDataEvent};
use state::AppState;
use tauri_plugin_log::{Target, TargetKind};
use tauri_specta::{collect_commands, collect_events, Builder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::is_mobile,
            commands::list_ports,
            commands::connect_port,
            commands::connect_ble,
            commands::disconnect_port,
            commands::set_load_on,
            commands::set_current,
            commands::set_cutoff_voltage,
            commands::set_timeout_seconds,
            commands::reset_counters,
            export::export_xlsx,
            ble::list_ble_devices,
            ble_test::ble_scan,
            ble_test::ble_probe,
        ])
        .events(collect_events![DeviceDataEvent, ConnectionStatusEvent]);

    // Regenerate the TypeScript bindings on every dev build so the frontend
    // never drifts from the Rust command/event definitions. Desktop-only:
    // the relative "../src" path assumes running from the source tree, which
    // doesn't hold on Android's sandboxed filesystem even in a debug build.
    #[cfg(all(debug_assertions, desktop))]
    specta_builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("failed to export typescript bindings");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_blec::init());

    // Desktop-only: remembers the main window's position/size (and
    // maximized state) across launches, so a window resized to actually fit
    // the dashboard doesn't reset back to the small `tauri.conf.json`
    // default (which only covers the very first run) every time the app
    // starts. No mobile equivalent - those windows are always fullscreen.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                // Third-party crates stay quiet at Info; our own code (backend
                // modules + frontend logs forwarded through the "webview"
                // target) logs at Debug so a session file has enough detail
                // to diagnose issues like "the chart looks wrong" after the
                // fact, without a firehose of dependency noise.
                .level(log::LevelFilter::Info)
                .level_for("tauri_app_lib", log::LevelFilter::Debug)
                .level_for(tauri_plugin_log::WEBVIEW_TARGET, log::LevelFilter::Debug)
                // Default cap is 40KB with RotationStrategy::KeepOne, which
                // *deletes and restarts* the file once hit - debug-level
                // telemetry logged every poll cycle blows past that in
                // under 10 minutes, silently wiping exactly the session
                // history a long-running diagnostic session needs. 20MB
                // covers many hours before that's even a concern.
                .max_file_size(20_000_000)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(logging::session_log_file_name()),
                    }),
                ])
                .build(),
        )
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);
            Ok(())
        })
        .manage(AppState::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
