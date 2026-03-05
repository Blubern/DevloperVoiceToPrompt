use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub azure_speech_key: String,
    pub azure_region: String,
    pub languages: Vec<String>,
    pub shortcut: String,
    pub microphone_device_id: String,
    pub theme: String,
    pub phrase_list: Vec<String>,
    pub always_on_top: bool,
    pub auto_punctuation: bool,
    pub silence_timeout_seconds: u32,
    pub history_enabled: bool,
    pub history_max_entries: u32,
    pub popup_copy_shortcut: String,
    pub popup_voice_shortcut: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            azure_speech_key: String::new(),
            azure_region: "eastus".into(),
            languages: vec!["en-US".into()],
            shortcut: "CommandOrControl+Shift+Space".into(),
            microphone_device_id: String::new(),
            theme: "dark".into(),
            phrase_list: vec![],
            always_on_top: true,
            auto_punctuation: true,
            silence_timeout_seconds: 30,
            history_enabled: true,
            history_max_entries: 50,
            popup_copy_shortcut: "CommandOrControl+Enter".into(),
            popup_voice_shortcut: "CommandOrControl+Shift+R".into(),
        }
    }
}

#[tauri::command]
pub fn toggle_popup(app: tauri::AppHandle) {
    crate::create_or_toggle_popup(&app);
}

#[tauri::command]
pub fn hide_popup(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("popup") {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn show_settings(app: tauri::AppHandle) {
    crate::show_settings(&app);
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> AppSettings {
    let stores = app.store("settings.json");
    if let Ok(store) = stores {
        let key = store.get("azure_speech_key").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_default();
        let region = store.get("azure_region").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "eastus".into());
        let languages = store.get("languages").and_then(|v: serde_json::Value| {
            v.as_array().map(|arr| arr.iter().filter_map(|item| item.as_str().map(String::from)).collect())
        }).unwrap_or_else(|| vec!["en-US".into()]);
        let shortcut = store.get("shortcut").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "CommandOrControl+Shift+Space".into());
        let microphone_device_id = store.get("microphone_device_id").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_default();
        let theme = store.get("theme").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "dark".into());
        let phrase_list = store.get("phrase_list").and_then(|v: serde_json::Value| {
            v.as_array().map(|arr| arr.iter().filter_map(|item| item.as_str().map(String::from)).collect())
        }).unwrap_or_default();
        let always_on_top = store.get("always_on_top").and_then(|v: serde_json::Value| v.as_bool()).unwrap_or(true);
        let auto_punctuation = store.get("auto_punctuation").and_then(|v: serde_json::Value| v.as_bool()).unwrap_or(true);
        let silence_timeout_seconds = store.get("silence_timeout_seconds").and_then(|v: serde_json::Value| v.as_u64()).unwrap_or(30) as u32;
        let history_enabled = store.get("history_enabled").and_then(|v: serde_json::Value| v.as_bool()).unwrap_or(false);
        let history_max_entries = store.get("history_max_entries").and_then(|v: serde_json::Value| v.as_u64()).unwrap_or(50) as u32;
        let popup_copy_shortcut = store.get("popup_copy_shortcut").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "CommandOrControl+Enter".into());
        let popup_voice_shortcut = store.get("popup_voice_shortcut").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "CommandOrControl+Shift+R".into());
        AppSettings {
            azure_speech_key: key,
            azure_region: region,
            languages,
            shortcut,
            microphone_device_id,
            theme,
            phrase_list,
            always_on_top,
            auto_punctuation,
            silence_timeout_seconds,
            history_enabled,
            history_max_entries,
            popup_copy_shortcut,
            popup_voice_shortcut,
        }
    } else {
        AppSettings::default()
    }
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e: tauri_plugin_store::Error| e.to_string())?;

    store.set("azure_speech_key", serde_json::json!(settings.azure_speech_key));
    store.set("azure_region", serde_json::json!(settings.azure_region));
    store.set("languages", serde_json::json!(settings.languages));
    store.set("shortcut", serde_json::json!(settings.shortcut));
    store.set("microphone_device_id", serde_json::json!(settings.microphone_device_id));
    store.set("theme", serde_json::json!(settings.theme));
    store.set("phrase_list", serde_json::json!(settings.phrase_list));
    store.set("always_on_top", serde_json::json!(settings.always_on_top));
    store.set("auto_punctuation", serde_json::json!(settings.auto_punctuation));
    store.set("silence_timeout_seconds", serde_json::json!(settings.silence_timeout_seconds));
    store.set("history_enabled", serde_json::json!(settings.history_enabled));
    store.set("history_max_entries", serde_json::json!(settings.history_max_entries));
    store.set("popup_copy_shortcut", serde_json::json!(settings.popup_copy_shortcut));
    store.set("popup_voice_shortcut", serde_json::json!(settings.popup_voice_shortcut));

    // Flush to disk immediately so settings survive dev restarts
    store.save().map_err(|e| format!("Failed to save settings to disk: {}", e))?;

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
