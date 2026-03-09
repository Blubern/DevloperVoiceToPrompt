use tauri::{Emitter, Manager};

mod commands;
mod copilot;
pub mod logging;
pub mod mcp;
pub mod settings;
mod tray;
mod whisper;
pub mod window_manager;

// Re-export for use by other modules (e.g., mcp.rs)
pub use window_manager::create_or_show_popup;

fn setup_global_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let shortcut_str = settings::load_settings(app).shortcut;

    let app_handle = app.clone();
    if shortcut_str.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut_str.as_str(), move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            window_manager::create_or_toggle_popup(&app_handle);
        }
    }) {
        tracing::error!(error = %e, "Failed to register global shortcut");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tracing::info!("Second instance launch intercepted; focusing existing app");
            create_or_show_popup(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(whisper::WhisperState::default())
        .manage(copilot::CopilotState::default())
        .manage(mcp::McpState::default())
        .manage(mcp::McpServerHandle::default())
        .invoke_handler(tauri::generate_handler![
            commands::toggle_popup,
            commands::hide_popup,
            commands::update_shortcut,
            commands::get_settings,
            commands::save_settings,
            commands::show_settings,
            commands::whisper_list_models,
            commands::whisper_download_model,
            commands::whisper_delete_model,
            commands::whisper_load_model,
            commands::whisper_transcribe,
            copilot::copilot_init,
            copilot::copilot_auth_status,
            copilot::copilot_list_models,
            copilot::copilot_stop,
            copilot::copilot_enhance,
            commands::get_logs,
            commands::clear_logs,
            commands::get_log_path,
            commands::open_log_folder,
            commands::get_app_data_path,
            commands::open_app_data_folder,
            commands::delete_all_whisper_models,
            commands::wipe_all_app_data,
            commands::mcp_submit_result,
            commands::mcp_cancel,
            commands::is_mcp_running,
        ])
        .on_window_event(|window, event| {
            // Hide the main/settings window instead of closing the app
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    // Restore popup's always_on_top from the stored setting
                    let app = window.app_handle();
                    if let Some(popup) = app.get_webview_window("popup") {
                        let on_top = settings::load_settings(app).always_on_top;
                        let _ = popup.set_always_on_top(on_top);
                    }
                }
            }
        })
        .setup(|app| {
            // Initialize tracing (file-based logging)
            let guard = logging::init_tracing(app.handle());
            // Keep the guard alive for the app's lifetime
            app.manage(guard);

            // Clean up log files older than 7 days
            logging::cleanup_old_logs(app.handle(), 7);

            tracing::info!("Application started");

            tray::setup_tray(app.handle())?;
            setup_global_shortcut(app.handle());

            // Load settings once for startup checks
            let user_settings = settings::load_settings(app.handle());

            // Start MCP server if enabled
            if user_settings.mcp_enabled {
                if (1024..=65535).contains(&user_settings.mcp_port) {
                    if let Err(e) = mcp::start_mcp_server(app.handle().clone(), user_settings.mcp_port) {
                        tracing::error!(error = %e, "Failed to start MCP server");
                    }
                } else {
                    tracing::error!(
                        port = user_settings.mcp_port,
                        "MCP port out of valid range (1024–65535); server not started"
                    );
                }
            }

            // Apply Dock (macOS) / Taskbar (Windows) visibility from saved settings
            commands::set_dock_visibility(app.handle(), user_settings.show_in_dock);

            // Open popup on startup if enabled in settings
            if user_settings.open_popup_on_start {
                window_manager::create_or_toggle_popup(app.handle());
            }

            // On first run, if no settings exist, show the settings window
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Err(e) = app_handle.emit("check-first-run", ()) {
                    tracing::warn!("Failed to emit check-first-run: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("Fatal application error: {e}");
            std::process::exit(1);
        });
}
