use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    webview::WebviewWindowBuilder,
    Emitter, Manager, WebviewUrl,
};
use tauri_plugin_store::StoreExt;

mod commands;
mod copilot;
pub mod logging;
pub mod mcp;
pub mod settings;
mod whisper;

/// Show the popup without toggling — always makes it visible and focused.
/// Used by the MCP server to open the popup when a tool call arrives.
pub fn create_or_show_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.show();
        let _ = win.set_focus();
    } else {
        create_or_toggle_popup(app);
    }
}

fn create_or_toggle_popup(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.set_focus();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    } else {
        let on_top = app
            .store("settings.json")
            .ok()
            .and_then(|store| store.get("always_on_top").and_then(|v| v.as_bool()))
            .unwrap_or(true);

        let show_in_dock = app
            .store("settings.json")
            .ok()
            .and_then(|store| store.get("show_in_dock").and_then(|v| v.as_bool()))
            .unwrap_or(true);

        // Read saved popup geometry from store
        let store = app.store("settings.json").ok();
        let popup_w = store.as_ref().and_then(|s| s.get("popup_width").and_then(|v| v.as_f64())).unwrap_or(926.0);
        let popup_h = store.as_ref().and_then(|s| s.get("popup_height").and_then(|v| v.as_f64())).unwrap_or(582.0);
        let popup_x = store.as_ref().and_then(|s| s.get("popup_x").and_then(|v| v.as_f64()));
        let popup_y = store.as_ref().and_then(|s| s.get("popup_y").and_then(|v| v.as_f64()));

        let mut builder = WebviewWindowBuilder::new(app, "popup", WebviewUrl::App("/".into()))
            .title("Voice to Prompt")
            .inner_size(popup_w, popup_h)
            .min_inner_size(350.0, 280.0)
            .decorations(false)
            .resizable(true)
            .skip_taskbar(!show_in_dock)
            .always_on_top(on_top)
            .visible(true);

        // Restore saved position, or center if none saved
        if let (Some(x), Some(y)) = (popup_x, popup_y) {
            builder = builder.position(x, y);
        } else {
            builder = builder.center();
        }

        let _win = builder.build();
    }
}

pub fn show_settings(app: &tauri::AppHandle) {
    // Temporarily lower the popup so the settings window is not hidden behind it
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup.set_always_on_top(false);
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItemBuilder::with_id("open", "Open Voice to Prompt").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let tray_builder = TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/icon.png"))?)
        .tooltip("Developer Voice to Prompt")
        .menu(&menu);

    #[cfg(target_os = "macos")]
    let tray_builder = tray_builder.icon_as_template(false);

    let _tray = tray_builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => create_or_toggle_popup(app),
            "settings" => show_settings(app),
            "quit" => {
                // Close all windows first so WebView2 cleans up properly
                for (_, win) in app.webview_windows() {
                    let _ = win.destroy();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                create_or_toggle_popup(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn setup_global_shortcut(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    use tauri_plugin_store::StoreExt;

    // Read saved shortcut from store, fall back to default
    let shortcut_str = app
        .store("settings.json")
        .ok()
        .and_then(|store| {
            store
                .get("shortcut")
                .and_then(|v: serde_json::Value| v.as_str().map(String::from))
        })
        .unwrap_or_else(|| "CommandOrControl+Alt+V".into());

    let app_handle = app.clone();
    if shortcut_str.is_empty() {
        return;
    }
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut_str.as_str(), move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            create_or_toggle_popup(&app_handle);
        }
    }) {
        tracing::error!(error = %e, "Failed to register global shortcut");
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
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
                        let on_top = app
                            .store("settings.json")
                            .ok()
                            .and_then(|store| store.get("always_on_top").and_then(|v| v.as_bool()))
                            .unwrap_or(true);
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

            setup_tray(app.handle())?;
            setup_global_shortcut(app.handle());

            // Load settings once for startup checks
            let user_settings = settings::load_settings(app.handle());

            // Start MCP server if enabled
            if user_settings.mcp_enabled {
                mcp::start_mcp_server(app.handle().clone(), user_settings.mcp_port);
            }

            // Apply Dock (macOS) / Taskbar (Windows) visibility from saved settings
            commands::set_dock_visibility(app.handle(), user_settings.show_in_dock);

            // Open popup on startup if enabled in settings
            if user_settings.open_popup_on_start {
                create_or_toggle_popup(app.handle());
            }

            // On first run, if no settings exist, show the settings window
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Small delay to let the store plugin initialize
                std::thread::sleep(std::time::Duration::from_millis(500));
                let _ = app_handle.emit("check-first-run", ());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
