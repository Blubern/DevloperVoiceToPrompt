use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::{self, AppSettings};

/// Re-register the global shortcut. Unregisters only the currently registered
/// shortcut (if any) first, then registers the given combo (if non-empty).
/// This avoids blanket unregister_all which could break other shortcuts.
fn register_shortcut(app: &tauri::AppHandle, shortcut: &str) -> Result<(), String> {
    let gs = app.global_shortcut();

    // Unregister the previously active shortcut instead of all shortcuts
    let old_shortcut = settings::load_settings(app).shortcut;
    if !old_shortcut.is_empty() {
        if let Err(e) = gs.unregister(old_shortcut.as_str()) {
            tracing::warn!(error = %e, shortcut = %old_shortcut, "Failed to unregister old shortcut");
        }
    }

    if shortcut.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    gs.on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            crate::create_or_toggle_popup(&app_handle);
        }
    })
    .map_err(|e| format!(
        "Failed to register shortcut '{}'. It may already be in use by another application. Try a different key combination. ({})",
        shortcut, e
    ))
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> AppSettings {
    settings::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    tracing::info!(provider = %settings.speech_provider, "Saving settings");

    if settings.mcp_timeout_seconds > 0 && !(10..=3600).contains(&settings.mcp_timeout_seconds) {
        return Err("MCP timeout must be between 10 and 3600 seconds, or 0 to disable it.".into());
    }

    if settings.mcp_enabled && !(1024..=65535).contains(&settings.mcp_port) {
        return Err("MCP port must be between 1024 and 65535.".into());
    }

    // Register the global shortcut BEFORE persisting, so a rejected shortcut
    // is never written to disk (which would break the app on next launch).
    register_shortcut(&app, settings.shortcut.as_str())?;

    // Snapshot old MCP settings before persisting so we can detect changes
    let old_settings = settings::load_settings(&app);
    let mcp_changed = old_settings.mcp_enabled != settings.mcp_enabled
        || old_settings.mcp_port != settings.mcp_port;

    settings::save_settings(&app, &settings)?;

    // Apply autostart setting
    let autolaunch = app.autolaunch();
    if settings.autostart_enabled {
        if let Err(e) = autolaunch.enable() {
            tracing::warn!("Failed to enable autostart: {e}");
        }
    } else {
        if let Err(e) = autolaunch.disable() {
            tracing::warn!("Failed to disable autostart: {e}");
        }
    }

    // Apply always_on_top to the popup window if it is currently open
    if let Some(popup) = app.get_webview_window("popup") {
        let _ = popup.set_always_on_top(settings.always_on_top);
    }

    // Apply Dock (macOS) / Taskbar (Windows) visibility
    super::window::set_dock_visibility(&app, settings.show_in_dock);

    // Apply MCP server changes (start/stop without requiring app restart)
    if mcp_changed {
        let server_handle = app.state::<crate::mcp::McpServerHandle>();
        crate::mcp::stop_mcp_server(&server_handle);
        if settings.mcp_enabled {
            crate::mcp::start_mcp_server(app.clone(), settings.mcp_port);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn update_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    register_shortcut(&app, &shortcut)
}
