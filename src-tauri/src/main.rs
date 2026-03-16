#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{
    GatewayProcessState, check_environment, create_install_folder, install_openclaw,
    probe_channels, read_gateway_status, restart_openclaw, start_openclaw,
    stop_openclaw, validate_platform_tokens, write_launcher_config,
    write_openclaw_config, write_secrets,
};
use std::sync::Mutex;

fn main() {
    tauri::Builder::default()
        .manage(GatewayProcessState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            check_environment,
            create_install_folder,
            write_launcher_config,
            write_secrets,
            write_openclaw_config,
            install_openclaw,
            start_openclaw,
            stop_openclaw,
            restart_openclaw,
            read_gateway_status,
            probe_channels,
            validate_platform_tokens
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}