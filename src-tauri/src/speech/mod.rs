// ---------------------------------------------------------------------------
// Native Speech Provider Framework
// ---------------------------------------------------------------------------
//
// Provides a trait + event emitter + registry for speech providers that run
// natively on the Rust/OS side (e.g. Apple SFSpeechRecognizer, Windows
// SpeechContinuousRecognitionSession).
//
// The TypeScript side uses a generic `NativeProviderProxy` that communicates
// with this framework via Tauri IPC commands and events.
//
// Event protocol:
//   speech://{provider_id}/interim   → { text: String }
//   speech://{provider_id}/final     → { text: String }
//   speech://{provider_id}/error     → { message: String }
//   speech://{provider_id}/status    → { status: String }  ("idle"|"listening"|"error")
//   speech://{provider_id}/audio-level   → { level: f32 }  (0.0–1.0)
//   speech://{provider_id}/decode-latency → { ms: u64 }
//   speech://{provider_id}/performance   → { rtf, avgRtf, inferenceMs, backend? }
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
pub mod apple;
#[cfg(target_os = "windows")]
pub mod windows;

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// SpeechEmitter — typed event emitter for native providers
// ---------------------------------------------------------------------------

/// Emits standardized Tauri events for a native speech provider.
/// Every native provider receives a `SpeechEmitter` when started and uses
/// it to push interim/final text, errors, status changes, and optional
/// metrics to the TypeScript `NativeProviderProxy`.
#[derive(Clone)]
pub struct SpeechEmitter {
    app: AppHandle,
    provider_id: String,
}

impl SpeechEmitter {
    pub fn new(app: AppHandle, provider_id: String) -> Self {
        Self { app, provider_id }
    }

    fn emit<T: Serialize + Clone>(&self, suffix: &str, payload: T) {
        let event = format!("speech://{}/{}", self.provider_id, suffix);
        if let Err(e) = self.app.emit(&event, payload) {
            tracing::warn!(
                provider = %self.provider_id,
                event = %event,
                error = %e,
                "Failed to emit speech event"
            );
        }
    }

    /// Emit an interim (partial) transcription result.
    pub fn interim(&self, text: &str) {
        self.emit("interim", SpeechTextPayload { text: text.to_string() });
    }

    /// Emit a final (committed) transcription result.
    pub fn final_text(&self, text: &str) {
        self.emit("final", SpeechTextPayload { text: text.to_string() });
    }

    /// Emit an error message.
    pub fn error(&self, message: &str) {
        self.emit("error", SpeechErrorPayload { message: message.to_string() });
    }

    /// Emit a status change ("idle", "listening", "error").
    pub fn status(&self, status: &str) {
        self.emit("status", SpeechStatusPayload { status: status.to_string() });
    }

    /// Emit a normalized audio level (0.0–1.0).
    pub fn audio_level(&self, level: f32) {
        self.emit("audio-level", SpeechAudioLevelPayload { level });
    }

    /// Emit decode latency in milliseconds.
    pub fn decode_latency(&self, ms: u64) {
        self.emit("decode-latency", SpeechDecodeLatencyPayload { ms });
    }

    /// Emit performance metrics.
    pub fn performance(&self, rtf: f64, avg_rtf: f64, inference_ms: u64, backend: Option<String>) {
        self.emit("performance", SpeechPerformancePayload {
            rtf,
            avg_rtf,
            inference_ms,
            backend,
        });
    }
}

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct SpeechTextPayload {
    text: String,
}

#[derive(Clone, Serialize)]
struct SpeechErrorPayload {
    message: String,
}

#[derive(Clone, Serialize)]
struct SpeechStatusPayload {
    status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechAudioLevelPayload {
    level: f32,
}

#[derive(Clone, Serialize)]
struct SpeechDecodeLatencyPayload {
    ms: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechPerformancePayload {
    rtf: f64,
    avg_rtf: f64,
    inference_ms: u64,
    backend: Option<String>,
}

// ---------------------------------------------------------------------------
// NativeSpeechProvider trait
// ---------------------------------------------------------------------------

/// Trait implemented by platform-specific speech providers that run on the
/// Rust/OS side. Each provider handles its own microphone capture and
/// speech recognition, emitting results via the `SpeechEmitter`.
pub trait NativeSpeechProvider: Send {
    /// Unique provider identifier (must match the TypeScript plugin descriptor).
    fn id(&self) -> &str;

    /// Start speech recognition with the given config.
    /// The provider should emit status "listening" via the emitter when ready.
    fn start(
        &mut self,
        config: serde_json::Value,
        emitter: SpeechEmitter,
    ) -> Result<(), String>;

    /// Stop speech recognition gracefully.
    /// The provider should emit status "idle" via the emitter when stopped.
    fn stop(&mut self) -> Result<(), String>;

    /// Check whether this provider is available on the current system.
    fn is_available(&self) -> bool;
}

// ---------------------------------------------------------------------------
// NativeSpeechRegistry — managed Tauri state
// ---------------------------------------------------------------------------

/// Thread-safe registry of native speech providers.
/// Stored as Tauri managed state, accessed by the generic dispatch commands.
pub struct NativeSpeechRegistry {
    providers: Mutex<HashMap<String, Box<dyn NativeSpeechProvider>>>,
}

impl NativeSpeechRegistry {
    pub fn new() -> Self {
        Self {
            providers: Mutex::new(HashMap::new()),
        }
    }

    /// Register a native speech provider. Called during app setup.
    pub fn register(&self, provider: Box<dyn NativeSpeechProvider>) {
        let id = provider.id().to_string();
        let mut providers = self.providers.lock().unwrap();
        providers.insert(id, provider);
    }
}

impl Default for NativeSpeechRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — generic dispatch to any registered native provider
// ---------------------------------------------------------------------------

/// Start a native speech provider by ID.
#[tauri::command]
pub async fn native_speech_start(
    provider_id: String,
    config: serde_json::Value,
    app: AppHandle,
    state: tauri::State<'_, NativeSpeechRegistry>,
) -> Result<(), String> {
    let emitter = SpeechEmitter::new(app, provider_id.clone());
    let mut providers = state.providers.lock().map_err(|e| e.to_string())?;
    let provider = providers
        .get_mut(&provider_id)
        .ok_or_else(|| format!("Native speech provider \"{provider_id}\" not registered"))?;
    provider.start(config, emitter)
}

/// Stop a native speech provider by ID.
#[tauri::command]
pub async fn native_speech_stop(
    provider_id: String,
    state: tauri::State<'_, NativeSpeechRegistry>,
) -> Result<(), String> {
    let mut providers = state.providers.lock().map_err(|e| e.to_string())?;
    let provider = providers
        .get_mut(&provider_id)
        .ok_or_else(|| format!("Native speech provider \"{provider_id}\" not registered"))?;
    provider.stop()
}

/// Check whether a native speech provider is available on this system.
#[tauri::command]
pub fn native_speech_available(
    provider_id: String,
    state: tauri::State<'_, NativeSpeechRegistry>,
) -> Result<bool, String> {
    let providers = state.providers.lock().map_err(|e| e.to_string())?;
    match providers.get(&provider_id) {
        Some(provider) => Ok(provider.is_available()),
        None => Ok(false),
    }
}
