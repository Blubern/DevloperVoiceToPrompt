use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::{self, AppSettings};

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> AppSettings {
    settings::load_settings(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    settings::save_settings(&app, &settings)?;

    // Apply autostart setting
    let autolaunch = app.autolaunch();
    if settings.autostart_enabled {
        let _ = autolaunch.enable();
    } else {
        let _ = autolaunch.disable();
    }

    // Re-register the global shortcut with the new key combo
    let gs = app.global_shortcut();

    // Unregister all existing shortcuts
    if let Err(e) = gs.unregister_all() {
        eprintln!("Failed to unregister shortcuts: {}", e);
    }

    // Only register if a shortcut is set (empty = disabled)
    if !settings.shortcut.is_empty() {
        let app_handle = app.clone();
        if let Err(e) = gs.on_shortcut(settings.shortcut.as_str(), move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                crate::create_or_toggle_popup(&app_handle);
            }
        }) {
            return Err(format!(
                "Failed to register shortcut '{}'. It may already be in use by another application. Try a different key combination. ({})",
                settings.shortcut, e
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn update_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    let gs = app.global_shortcut();

    if let Err(e) = gs.unregister_all() {
        eprintln!("Failed to unregister shortcuts: {}", e);
    }

    if shortcut.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    gs.on_shortcut(shortcut.as_str(), move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            crate::create_or_toggle_popup(&app_handle);
        }
    })
    .map_err(|e| format!(
        "Failed to register shortcut '{}'. It may already be in use by another application. Try a different key combination. ({})",
        shortcut, e
    ))
}
