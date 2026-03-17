#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{
    GatewayProcessState,
    // core
    check_environment, create_install_folder, install_openclaw,
    probe_channels, read_gateway_status, ping_gateway, read_gateway_log,
    set_auto_start, get_auto_start,
    restart_openclaw, start_openclaw, stop_openclaw,
    validate_platform_tokens, write_launcher_config,
    write_openclaw_config, write_secrets,
    // batch 2
    check_for_updates, run_update,
    read_usage_stats, watchdog_check,
    validate_openai_key_live, validate_discord_token_live,
    // batch 3
    send_notification, set_discord_avatar,
    read_openclaw_config, write_openclaw_config_raw,
    create_backup, list_backups, restore_backup,
};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(GatewayProcessState(Mutex::new(None)))
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show ClawLaunch", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit ClawLaunch", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("ClawLaunch")
                .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // core
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
            ping_gateway,
            read_gateway_log,
            set_auto_start,
            get_auto_start,
            probe_channels,
            validate_platform_tokens,
            // batch 2
            check_for_updates,
            run_update,
            read_usage_stats,
            watchdog_check,
            validate_openai_key_live,
            validate_discord_token_live,
            // batch 3
            send_notification,
            set_discord_avatar,
            read_openclaw_config,
            write_openclaw_config_raw,
            create_backup,
            list_backups,
            restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}