use std::fs;
use tauri::Manager;

use crate::{logging, whisper};

/// Returns the app data directory path as a string for display in the UI.
#[tauri::command]
pub async fn get_app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Opens the app data folder in the system file explorer (Explorer on Windows, Finder on macOS).
#[tauri::command]
pub async fn open_app_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;

    // Ensure the directory exists before trying to open it
    let _ = fs::create_dir_all(&dir);

    let path_str = dir.to_string_lossy().to_string();
    app.shell()
        .open(&path_str, None)
        .map_err(|e| format!("Failed to open app data folder: {e}"))?;

    Ok(())
}

/// Deletes all downloaded Whisper model (.bin) files without removing the models directory.
#[tauri::command]
pub async fn delete_all_whisper_models(app: tauri::AppHandle) -> Result<(), String> {
    let dir = whisper::models_dir(&app)?;

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read models directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("bin") {
            let _ = fs::remove_file(&path);
        }
    }

    Ok(())
}

/// Wipes all app data (Whisper models, store JSON files, log files) and restarts the app.
/// This is the equivalent of a clean uninstall: after restart the app starts from defaults.
#[tauri::command]
pub async fn wipe_all_app_data(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;

    // Remove the Whisper models directory
    let models_dir = data_dir.join("whisper-models");
    if models_dir.exists() {
        let _ = fs::remove_dir_all(&models_dir);
    }

    // Remove all tauri-plugin-store JSON files
    for file in &[
        "settings.json",
        "history.json",
        "templates.json",
        "enhancer-templates.json",
        "usage.json",
    ] {
        let path = data_dir.join(file);
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
    }

    // Remove the log directory
    let log_dir = logging::log_dir(&app);
    if log_dir.exists() {
        let _ = fs::remove_dir_all(&log_dir);
    }

    // Restart the app — request_restart is available directly on AppHandle in Tauri 2
    app.request_restart();
    Ok(())
}
