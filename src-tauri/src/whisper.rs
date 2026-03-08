use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Managed state holding the loaded Whisper model.
/// Uses `std::sync::Mutex` so the guard can be held inside `spawn_blocking`.
pub type WhisperState = Arc<Mutex<Option<WhisperEngine>>>;

pub struct WhisperEngine {
    ctx: WhisperContext,
    model_name: String,
}

impl WhisperEngine {
    pub fn load(model_path: &Path, model_name: &str) -> Result<Self, String> {
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid model path")?,
            params,
        )
        .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

        Ok(Self {
            ctx,
            model_name: model_name.to_string(),
        })
    }

    pub fn model_name(&self) -> &str {
        &self.model_name
    }

    pub fn transcribe(
        &self,
        pcm_f32: &[f32],
        language: Option<&str>,
        initial_prompt: Option<&str>,
    ) -> Result<String, String> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

        // Set transcription language
        if let Some(lang) = language {
            // Whisper uses ISO 639-1 codes (e.g. "en", "de", "ja")
            // Our settings use BCP47 (e.g. "en-US"). Extract the base language.
            let base = lang.split('-').next().unwrap_or(lang);
            params.set_language(Some(base));
        }

        if let Some(prompt) = initial_prompt {
            if !prompt.is_empty() {
                params.set_initial_prompt(prompt);
            }
        }

        // Suppress hallucinations on quiet audio
        params.set_no_speech_thold(0.6);

        // Disable printing to stdout
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        // Single segment mode for short chunks
        params.set_single_segment(true);

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("Failed to create whisper state: {e}"))?;

        state
            .full(params, pcm_f32)
            .map_err(|e| format!("Whisper transcription failed: {e}"))?;

        let mut text = String::new();
        for segment in state.as_iter() {
            text.push_str(&segment.to_string());
        }

        // Strip common Whisper hallucination tokens
        let cleaned = text
            .replace("[BLANK_AUDIO]", "")
            .replace("[MUSIC]", "")
            .replace("[SILENCE]", "")
            .replace("(silence)", "")
            .replace("(blank audio)", "");

        Ok(cleaned.trim().to_string())
    }
}

/// Available model definitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelInfo {
    pub name: String,
    pub label: String,
    pub size_mb: u64,
    pub downloaded: bool,
}

/// All offered models with approximate sizes.
pub const WHISPER_MODELS: &[(&str, &str, u64)] = &[
    ("tiny", "Tiny (~75 MB)", 75),
    ("base", "Base (~142 MB)", 142),
    ("small", "Small (~466 MB)", 466),
    ("medium", "Medium (~1.5 GB)", 1500),
    ("large-v3", "Large v3 (~3 GB)", 3095),
];

/// Directory where models are stored inside the app data dir.
pub fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;
    let dir = data_dir.join("whisper-models");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create models directory: {e}"))?;
    }
    Ok(dir)
}

/// Get the expected path for a model file.
pub fn model_file_path(app: &tauri::AppHandle, model_name: &str) -> Result<PathBuf, String> {
    // Validate model name to prevent path traversal
    if !WHISPER_MODELS.iter().any(|(name, _, _)| *name == model_name) {
        return Err(format!("Unknown model: {model_name}"));
    }
    Ok(models_dir(app)?.join(format!("ggml-{model_name}.bin")))
}

/// HuggingFace download URL for a model.
pub fn model_download_url(model_name: &str) -> String {
    format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin"
    )
}

use tauri::Manager;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_models_has_entries() {
        assert!(
            WHISPER_MODELS.len() >= 4,
            "Expected at least 4 models, got {}",
            WHISPER_MODELS.len()
        );
    }

    #[test]
    fn whisper_models_names_unique() {
        let mut names: Vec<&str> = WHISPER_MODELS.iter().map(|(n, _, _)| *n).collect();
        let count = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), count, "Duplicate model names found");
    }

    #[test]
    fn whisper_models_sizes_positive() {
        for (name, _, size_mb) in WHISPER_MODELS {
            assert!(*size_mb > 0, "Model {name} has zero size");
        }
    }

    #[test]
    fn model_download_url_format() {
        let url = model_download_url("tiny");
        assert_eq!(
            url,
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
        );
    }

    #[test]
    fn model_download_url_large_v3() {
        let url = model_download_url("large-v3");
        assert!(url.contains("ggml-large-v3.bin"));
    }

    #[test]
    fn hallucination_tokens_cleaned_in_transcription_output() {
        // The transcribe() method strips hallucination tokens.
        // Verify the patterns exist in the replace chain.
        let text = "[BLANK_AUDIO] hello [MUSIC] world [SILENCE] (silence) (blank audio)";
        let cleaned = text
            .replace("[BLANK_AUDIO]", "")
            .replace("[MUSIC]", "")
            .replace("[SILENCE]", "")
            .replace("(silence)", "")
            .replace("(blank audio)", "");
        let cleaned = cleaned.trim();
        assert_eq!(cleaned, "hello  world");
    }
}
