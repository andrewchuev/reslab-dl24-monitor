#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod protocol;
mod serial;
mod state;

use commands::{ConnectionStatusEvent, DeviceDataEvent};
use state::AppState;
use tauri_specta::{collect_commands, collect_events, Builder};

pub fn run() {
    let specta_builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::list_ports,
            commands::connect_port,
            commands::disconnect_port,
            commands::set_load_on,
            commands::set_current,
            commands::set_cutoff_voltage,
            commands::set_timeout_seconds,
            commands::reset_counters,
        ])
        .events(collect_events![DeviceDataEvent, ConnectionStatusEvent]);

    // Regenerate the TypeScript bindings on every dev build so the frontend
    // never drifts from the Rust command/event definitions.
    #[cfg(debug_assertions)]
    specta_builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
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
