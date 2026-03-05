use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_store::StoreExt;

use crate::whisper::{self, WhisperModelInfo, WhisperState, WHISPER_MODELS};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
            provider_switch_shortcut: String::new(),
            whisper_model: "base".into(),
            whisper_language: "en-US".into(),
            whisper_chunk_seconds: 5,
            max_recording_enabled: true,
            max_recording_seconds: 180,
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
        let speech_provider = store.get("speech_provider").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "os".into());
        let os_language = store.get("os_language").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "en-US".into());
        let os_auto_restart = store.get("os_auto_restart").and_then(|v: serde_json::Value| v.as_bool()).unwrap_or(true);
        let os_max_restarts = store.get("os_max_restarts").and_then(|v: serde_json::Value| v.as_u64()).unwrap_or(3) as u32;
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
        let provider_switch_shortcut = store.get("provider_switch_shortcut").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_default();
        let whisper_model = store.get("whisper_model").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "base".into());
        let whisper_language = store.get("whisper_language").and_then(|v: serde_json::Value| v.as_str().map(String::from)).unwrap_or_else(|| "en-US".into());
        let whisper_chunk_seconds = store.get("whisper_chunk_seconds").and_then(|v: serde_json::Value| v.as_u64()).unwrap_or(5) as u32;
        let max_recording_enabled = store.get("max_recording_enabled").and_then(|v: serde_json::Value| v.as_bool()).unwrap_or(true);
        let max_recording_seconds = store.get("max_recording_seconds").and_then(|v: serde_json::Value| v.as_u64()).unwrap_or(180) as u32;
        AppSettings {
            speech_provider,
            os_language,
            os_auto_restart,
            os_max_restarts,
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
            provider_switch_shortcut,
            whisper_model,
            whisper_language,
            whisper_chunk_seconds,
            max_recording_enabled,
            max_recording_seconds,
        }
    } else {
        AppSettings::default()
    }
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e: tauri_plugin_store::Error| e.to_string())?;

    store.set("speech_provider", serde_json::json!(settings.speech_provider));
    store.set("os_language", serde_json::json!(settings.os_language));
    store.set("os_auto_restart", serde_json::json!(settings.os_auto_restart));
    store.set("os_max_restarts", serde_json::json!(settings.os_max_restarts));
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
    store.set("provider_switch_shortcut", serde_json::json!(settings.provider_switch_shortcut));
    store.set("whisper_model", serde_json::json!(settings.whisper_model));
    store.set("whisper_language", serde_json::json!(settings.whisper_language));
    store.set("whisper_chunk_seconds", serde_json::json!(settings.whisper_chunk_seconds));
    store.set("max_recording_enabled", serde_json::json!(settings.max_recording_enabled));
    store.set("max_recording_seconds", serde_json::json!(settings.max_recording_seconds));

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

// ---------------------------------------------------------------------------
// Whisper commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn whisper_list_models(app: tauri::AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    let mut models = Vec::new();
    for (name, label, size_mb) in WHISPER_MODELS {
        let path = whisper::model_file_path(&app, name)?;
        models.push(WhisperModelInfo {
            name: name.to_string(),
            label: label.to_string(),
            size_mb: *size_mb,
            downloaded: path.exists(),
        });
    }
    Ok(models)
}

#[tauri::command]
pub async fn whisper_download_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let path = whisper::model_file_path(&app, &model_name)?;
    if path.exists() {
        return Ok(());
    }

    let url = whisper::model_download_url(&model_name);
    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Write to a temp file first, then rename on success
    let tmp_path = path.with_extension("bin.tmp");
    let mut file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut stream = resp.bytes_stream();
    use std::io::Write;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write model data: {e}"))?;
        downloaded += chunk.len() as u64;

        // Emit progress event to frontend
        let _ = app.emit(
            "whisper-download-progress",
            serde_json::json!({
                "model": model_name,
                "downloaded": downloaded,
                "total": total_size,
            }),
        );
    }

    file.flush().map_err(|e| format!("Failed to flush file: {e}"))?;
    drop(file);

    // Rename temp file to final
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize model file: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn whisper_delete_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    let path = whisper::model_file_path(&app, &model_name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn whisper_load_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    model_name: String,
) -> Result<(), String> {
    let path = whisper::model_file_path(&app, &model_name)?;
    if !path.exists() {
        return Err(format!(
            "Model '{}' not downloaded. Please download it first.",
            model_name
        ));
    }

    // Check if already loaded (quick lock)
    {
        let guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(engine) = guard.as_ref() {
            if engine.model_name() == model_name {
                return Ok(());
            }
        }
    }

    // Load model on a blocking thread (CPU-intensive)
    let path_clone = path.clone();
    let name_clone = model_name.clone();
    let engine = tokio::task::spawn_blocking(move || {
        whisper::WhisperEngine::load(&path_clone, &name_clone)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    let mut guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    *guard = Some(engine);
    Ok(())
}

#[tauri::command]
pub async fn whisper_transcribe(
    state: tauri::State<'_, WhisperState>,
    audio_b64: String,
    sample_rate: u32,
    language: Option<String>,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    // Decode base64 → raw bytes → f32 PCM samples (little-endian)
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_b64)
        .map_err(|e| format!("Invalid base64 audio data: {e}"))?;

    let pcm_f32: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();

    // Resample to 16 kHz if needed
    let samples = if sample_rate != 16000 {
        resample(&pcm_f32, sample_rate, 16000)
    } else {
        pcm_f32
    };

    // Clone the Arc so we can move it into spawn_blocking
    let state_clone = state.inner().clone();

    // Transcribe on a blocking thread (CPU-bound)
    tokio::task::spawn_blocking(move || {
        let guard = state_clone
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        let engine = guard
            .as_ref()
            .ok_or("No Whisper model loaded. Load a model first.")?;

        let lang = language.as_deref();
        let prompt = initial_prompt.as_deref();
        engine.transcribe(&samples, lang, prompt)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

/// Simple linear resampler for converting audio sample rates.
fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx = src_idx as usize;
        let frac = src_idx - idx as f64;
        let sample = if idx + 1 < input.len() {
            input[idx] as f64 * (1.0 - frac) + input[idx + 1] as f64 * frac
        } else {
            input[idx.min(input.len() - 1)] as f64
        };
        output.push(sample as f32);
    }
    output
}
