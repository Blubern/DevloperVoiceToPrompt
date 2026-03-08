use crate::whisper::{self, WhisperModelInfo, WhisperState, WHISPER_MODELS};

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
pub async fn whisper_load_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperState>,
    model_name: String,
) -> Result<(), String> {
    tracing::info!(model = %model_name, "Loading Whisper model");
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
    // Input validation
    if sample_rate == 0 {
        return Err("Invalid sample rate: must be greater than 0".into());
    }

    if audio_b64.is_empty() {
        return Ok(String::new());
    }

    // Decode base64 → raw bytes → f32 PCM samples (little-endian)
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &audio_b64)
        .map_err(|e| format!("Invalid base64 audio data: {e}"))?;

    if bytes.len() < 4 {
        return Ok(String::new());
    }

    if bytes.len() % 4 != 0 {
        tracing::warn!(
            "Audio data has {} trailing bytes (not aligned to f32); truncating",
            bytes.len() % 4
        );
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_same_rate_passthrough() {
        let input = vec![1.0, 2.0, 3.0];
        let out = resample(&input, 16000, 16000);
        assert_eq!(out, input);
    }

    #[test]
    fn resample_empty_input() {
        let out = resample(&[], 48000, 16000);
        assert!(out.is_empty());
    }

    #[test]
    fn resample_48k_to_16k_length() {
        // 48 kHz → 16 kHz is a 3:1 ratio, so output should be ~1/3 the input length.
        let input: Vec<f32> = (0..4800).map(|i| (i as f32).sin()).collect();
        let out = resample(&input, 48000, 16000);
        assert_eq!(out.len(), 1600);
    }

    #[test]
    fn resample_preserves_dc_signal() {
        // A constant signal should remain constant after resampling.
        let input = vec![0.5_f32; 4800];
        let out = resample(&input, 48000, 16000);
        for &s in &out {
            assert!((s - 0.5).abs() < 1e-6, "sample {} deviates from 0.5", s);
        }
    }

    #[test]
    fn resample_upsample_16k_to_48k() {
        let input: Vec<f32> = (0..1600).map(|i| i as f32 / 1600.0).collect();
        let out = resample(&input, 16000, 48000);
        assert_eq!(out.len(), 4800);
    }
}
