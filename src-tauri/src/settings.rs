use serde::{Deserialize, Serialize};

/// Application settings, stored as a single JSON object in the Tauri store.
///
/// Uses `#[serde(default)]` so that missing fields fall back to `Default::default()`.
/// This means adding a new field only requires updating this struct and its `Default` impl —
/// no manual migration of individual store keys needed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub speech_provider: String,
    pub os_language: String,
    pub os_auto_restart: bool,
    pub os_max_restarts: u32,
    pub azure_speech_key: String,
    pub azure_region: String,
    pub languages: Vec<String>,
    pub shortcut: String,
    pub microphone_device_id: String,
    pub theme: String,
    pub phrase_list: Vec<String>,
    pub always_on_top: bool,
    pub auto_punctuation: bool,
    pub auto_start_recording: bool,
    pub silence_timeout_seconds: u32,
    pub history_enabled: bool,
    pub history_max_entries: u32,
    pub popup_copy_shortcut: String,
    pub popup_voice_shortcut: String,
    pub provider_switch_shortcut: String,
    pub whisper_model: String,
    pub whisper_language: String,
    pub whisper_chunk_seconds: u32,
    pub max_recording_enabled: bool,
    pub max_recording_seconds: u32,
    pub autostart_enabled: bool,
    pub copilot_enabled: bool,
    pub copilot_selected_model: String,
    pub copilot_selected_enhancer: String,
    pub copilot_delete_sessions: bool,
    pub prompt_enhancer_shortcut: String,
    pub popup_font: String,
    pub open_popup_on_start: bool,
    pub mcp_enabled: bool,
    pub mcp_port: u16,
    pub mcp_timeout_seconds: u32,
    pub show_in_dock: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            speech_provider: "os".into(),
            os_language: "en-US".into(),
            os_auto_restart: true,
            os_max_restarts: 3,
            azure_speech_key: String::new(),
            azure_region: "eastus".into(),
            languages: vec!["en-US".into()],
            shortcut: "CommandOrControl+Alt+V".into(),
            microphone_device_id: String::new(),
            theme: "dark".into(),
            phrase_list: vec![],
            always_on_top: false,
            auto_punctuation: true,
            auto_start_recording: false,
            silence_timeout_seconds: 30,
            history_enabled: true,
            history_max_entries: 50,
            popup_copy_shortcut: "CommandOrControl+Enter".into(),
            popup_voice_shortcut: "CommandOrControl+Shift+M".into(),
            provider_switch_shortcut: "CommandOrControl+Shift+P".into(),
            whisper_model: "base".into(),
            whisper_language: "en-US".into(),
            whisper_chunk_seconds: 3,
            max_recording_enabled: true,
            max_recording_seconds: 180,
            autostart_enabled: false,
            copilot_enabled: false,
            copilot_selected_model: String::new(),
            copilot_selected_enhancer: String::new(),
            copilot_delete_sessions: true,
            prompt_enhancer_shortcut: "CommandOrControl+Shift+E".into(),
            popup_font: "mono".into(),
            open_popup_on_start: true,
            mcp_enabled: false,
            mcp_port: 31337,
            mcp_timeout_seconds: 300,
            show_in_dock: false,
        }
    }
}

const SETTINGS_STORE_KEY: &str = "app_settings";

/// Load settings from the Tauri store.
///
/// First tries the new single-object key. If absent, attempts to migrate
/// from the old per-field storage format (backward compatibility).
pub fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    use tauri_plugin_store::StoreExt;

    let Ok(store) = app.store("settings.json") else {
        return AppSettings::default();
    };

    // Try loading from the new single-object key
    if let Some(val) = store.get(SETTINGS_STORE_KEY) {
        if let Ok(settings) = serde_json::from_value::<AppSettings>(val.clone()) {
            return settings;
        }
    }

    // Migration: read old individual keys into an AppSettings struct
    let settings = migrate_from_individual_keys(&store);

    // Persist as single object for next time
    if let Ok(val) = serde_json::to_value(&settings) {
        store.set(SETTINGS_STORE_KEY, val);
        let _ = store.save();
    }

    settings
}

/// Save settings to the Tauri store as a single JSON object.
pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("settings.json")
        .map_err(|e: tauri_plugin_store::Error| e.to_string())?;

    let val = serde_json::to_value(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;

    store.set(SETTINGS_STORE_KEY, val);

    // Also write individual keys that lib.rs reads directly (shortcut, always_on_top, popup geometry)
    store.set("shortcut", serde_json::json!(settings.shortcut));
    store.set("always_on_top", serde_json::json!(settings.always_on_top));

    store
        .save()
        .map_err(|e| format!("Failed to save settings to disk: {e}"))?;

    Ok(())
}

/// One-time migration: read the old per-field keys and assemble an AppSettings.
fn migrate_from_individual_keys(store: &tauri_plugin_store::Store<tauri::Wry>) -> AppSettings {
    let defaults = AppSettings::default();

    let get_str = |key: &str, default: &str| -> String {
        store
            .get(key)
            .and_then(|v: serde_json::Value| v.as_str().map(String::from))
            .unwrap_or_else(|| default.to_string())
    };

    let get_bool = |key: &str, default: bool| -> bool {
        store
            .get(key)
            .and_then(|v: serde_json::Value| v.as_bool())
            .unwrap_or(default)
    };

    let get_u32 = |key: &str, default: u32| -> u32 {
        store
            .get(key)
            .and_then(|v: serde_json::Value| v.as_u64())
            .unwrap_or(default as u64) as u32
    };

    let get_str_vec = |key: &str, default: &[String]| -> Vec<String> {
        store
            .get(key)
            .and_then(|v: serde_json::Value| {
                v.as_array()
                    .map(|arr| arr.iter().filter_map(|item| item.as_str().map(String::from)).collect())
            })
            .unwrap_or_else(|| default.to_vec())
    };

    AppSettings {
        speech_provider: get_str("speech_provider", &defaults.speech_provider),
        os_language: get_str("os_language", &defaults.os_language),
        os_auto_restart: get_bool("os_auto_restart", defaults.os_auto_restart),
        os_max_restarts: get_u32("os_max_restarts", defaults.os_max_restarts),
        azure_speech_key: get_str("azure_speech_key", &defaults.azure_speech_key),
        azure_region: get_str("azure_region", &defaults.azure_region),
        languages: get_str_vec("languages", &defaults.languages),
        shortcut: get_str("shortcut", &defaults.shortcut),
        microphone_device_id: get_str("microphone_device_id", &defaults.microphone_device_id),
        theme: get_str("theme", &defaults.theme),
        phrase_list: get_str_vec("phrase_list", &defaults.phrase_list),
        always_on_top: get_bool("always_on_top", defaults.always_on_top),
        auto_punctuation: get_bool("auto_punctuation", defaults.auto_punctuation),
        auto_start_recording: get_bool("auto_start_recording", defaults.auto_start_recording),
        silence_timeout_seconds: get_u32("silence_timeout_seconds", defaults.silence_timeout_seconds),
        history_enabled: get_bool("history_enabled", defaults.history_enabled),
        history_max_entries: get_u32("history_max_entries", defaults.history_max_entries),
        popup_copy_shortcut: get_str("popup_copy_shortcut", &defaults.popup_copy_shortcut),
        popup_voice_shortcut: get_str("popup_voice_shortcut", &defaults.popup_voice_shortcut),
        provider_switch_shortcut: get_str("provider_switch_shortcut", &defaults.provider_switch_shortcut),
        whisper_model: get_str("whisper_model", &defaults.whisper_model),
        whisper_language: get_str("whisper_language", &defaults.whisper_language),
        whisper_chunk_seconds: get_u32("whisper_chunk_seconds", defaults.whisper_chunk_seconds),
        max_recording_enabled: get_bool("max_recording_enabled", defaults.max_recording_enabled),
        max_recording_seconds: get_u32("max_recording_seconds", defaults.max_recording_seconds),
        autostart_enabled: get_bool("autostart_enabled", defaults.autostart_enabled),
        copilot_enabled: get_bool("copilot_enabled", defaults.copilot_enabled),
        copilot_selected_model: get_str("copilot_selected_model", &defaults.copilot_selected_model),
        copilot_selected_enhancer: get_str("copilot_selected_enhancer", &defaults.copilot_selected_enhancer),
        copilot_delete_sessions: get_bool("copilot_delete_sessions", defaults.copilot_delete_sessions),
        prompt_enhancer_shortcut: get_str("prompt_enhancer_shortcut", &defaults.prompt_enhancer_shortcut),
        popup_font: get_str("popup_font", &defaults.popup_font),
        open_popup_on_start: get_bool("open_popup_on_start", defaults.open_popup_on_start),
        mcp_enabled: get_bool("mcp_enabled", defaults.mcp_enabled),
        mcp_port: get_u32("mcp_port", defaults.mcp_port as u32) as u16,
        mcp_timeout_seconds: get_u32("mcp_timeout_seconds", defaults.mcp_timeout_seconds),
        show_in_dock: get_bool("show_in_dock", defaults.show_in_dock),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_roundtrip() {
        let original = AppSettings::default();
        let json = serde_json::to_value(&original).unwrap();
        let deserialized: AppSettings = serde_json::from_value(json).unwrap();
        assert_eq!(original.speech_provider, deserialized.speech_provider);
        assert_eq!(original.shortcut, deserialized.shortcut);
        assert_eq!(original.languages, deserialized.languages);
        assert_eq!(original.max_recording_seconds, deserialized.max_recording_seconds);
        assert_eq!(original.mcp_timeout_seconds, deserialized.mcp_timeout_seconds);
    }

    #[test]
    fn missing_fields_use_defaults() {
        let json = serde_json::json!({"speech_provider": "azure"});
        let settings: AppSettings = serde_json::from_value(json).unwrap();
        assert_eq!(settings.speech_provider, "azure");
        // All other fields should be defaults
        assert_eq!(settings.os_language, "en-US");
        assert_eq!(settings.shortcut, "CommandOrControl+Alt+V");
        assert!(!settings.always_on_top);
        assert_eq!(settings.mcp_timeout_seconds, 300);
    }

    #[test]
    fn empty_json_gives_defaults() {
        let json = serde_json::json!({});
        let settings: AppSettings = serde_json::from_value(json).unwrap();
        let defaults = AppSettings::default();
        assert_eq!(settings.speech_provider, defaults.speech_provider);
        assert_eq!(settings.max_recording_seconds, defaults.max_recording_seconds);
    }
}
