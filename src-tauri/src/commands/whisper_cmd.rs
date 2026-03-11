use crate::whisper_cli::{
    self, CliStatus, GpuInfo, WhisperModelInfo, WhisperServerState, WHISPER_MODELS,
};

#[tauri::command]
pub fn whisper_list_models(app: tauri::AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    let mut models = Vec::new();
    for (name, label, size_mb) in WHISPER_MODELS {
        let path = whisper_cli::model_file_path(&app, name)?;
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
pub async fn whisper_start_server(
    app: tauri::AppHandle,
    state: tauri::State<'_, WhisperServerState>,
    model_name: String,
    language: String,
    use_gpu: bool,
) -> Result<(), String> {
    tracing::info!(model = %model_name, "Starting whisper-server");

    let model_path = whisper_cli::model_file_path(&app, &model_name)?;
    if !model_path.exists() {
        return Err(format!(
            "Model '{}' not downloaded. Please download it first.",
            model_name
        ));
    }

    let server_path = whisper_cli::server_executable_path(&app)?;

    // Check if already running with same model (idempotent)
    {
        let guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(proc) = guard.as_ref() {
            if proc.model_name == model_name {
                tracing::info!(model = %model_name, port = proc.port, "Server already running with same model");
                return Ok(());
            }
        }
    }

    // Stop old server if running with different model
    {
        let mut guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(mut proc) = guard.take() {
            tracing::info!(model = %proc.model_name, "Stopping old whisper-server");
            proc.kill();
        }
    }

    let port = whisper_cli::find_available_port()?;

    let process = whisper_cli::start_server(
        &server_path,
        &model_path,
        &model_name,
        &language,
        use_gpu,
        port,
    )
    .await?;

    let mut guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    *guard = Some(process);
    Ok(())
}

#[tauri::command]
pub async fn whisper_stop_server(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<(), String> {
    let taken = {
        let mut guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        guard.take()
    };
    if let Some(mut proc) = taken {
        tracing::info!(model = %proc.model_name, port = proc.port, "Stopping whisper-server");
        proc.kill_and_wait(3000).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn whisper_transcribe(
    state: tauri::State<'_, WhisperServerState>,
    audio_b64: String,
    sample_rate: u32,
    _language: Option<String>,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    // Input validation
    if sample_rate == 0 {
        return Err("Invalid sample rate: must be greater than 0".into());
    }

    const MIN_SAMPLE_RATE: u32 = 8_000;
    const MAX_SAMPLE_RATE: u32 = 192_000;
    if sample_rate < MIN_SAMPLE_RATE || sample_rate > MAX_SAMPLE_RATE {
        return Err(format!(
            "Invalid sample rate {sample_rate}: must be between {MIN_SAMPLE_RATE} and {MAX_SAMPLE_RATE}"
        ));
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

    // Get port from state
    let port = {
        let guard = state.lock().map_err(|e| {
            tracing::error!("Whisper state lock poisoned during transcribe");
            format!("Lock poisoned: {e}")
        })?;
        guard
            .as_ref()
            .ok_or_else(|| {
                tracing::error!("Transcription attempted but whisper-server is not running");
                "whisper-server not running. Start the server first.".to_string()
            })?
            .port
    };

    // Convert to WAV and send to server
    let wav_bytes = whisper_cli::write_wav_16bit(&samples, 16000);
    let prompt = initial_prompt.as_deref();

    whisper_cli::transcribe_via_server(port, wav_bytes, prompt).await
}

#[tauri::command]
pub fn whisper_check_cli(app: tauri::AppHandle) -> Result<CliStatus, String> {
    whisper_cli::find_server_executable(&app)
}

#[tauri::command]
pub fn whisper_detect_gpu() -> GpuInfo {
    whisper_cli::detect_gpu()
}

#[derive(serde::Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub model_name: Option<String>,
    pub port: Option<u16>,
}

#[tauri::command]
pub fn whisper_server_status(
    state: tauri::State<'_, WhisperServerState>,
) -> Result<ServerStatus, String> {
    let mut guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

    // Check if the process is still alive; clear state if it died unexpectedly
    let alive = if let Some(proc) = guard.as_mut() {
        match proc.try_wait() {
            Ok(Some(status)) => {
                tracing::warn!(port = proc.port, model = %proc.model_name, ?status, "whisper-server exited unexpectedly");
                false
            }
            Ok(None) => true,  // still running
            Err(_) => false,
        }
    } else {
        false
    };

    if !alive {
        // Clear dead process from state
        if guard.is_some() {
            *guard = None;
        }
        return Ok(ServerStatus { running: false, model_name: None, port: None });
    }

    let proc = guard.as_ref().unwrap();
    Ok(ServerStatus {
        running: true,
        model_name: Some(proc.model_name.clone()),
        port: Some(proc.port),
    })
}

/// Resample `input` from `from_rate` Hz to `to_rate` Hz.
///
/// Downsampling uses a box filter (arithmetic mean over each output window) to
/// provide basic anti-aliasing and avoid the spectral artefacts produced by
/// naive sample-and-hold / linear interpolation without a low-pass pre-filter.
/// Upsampling uses linear interpolation (no aliasing concern there).
fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (input.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(out_len);

    if from_rate > to_rate {
        for i in 0..out_len {
            let src_start = (i as f64 * ratio) as usize;
            let src_end = (((i + 1) as f64 * ratio) as usize).min(input.len());
            if src_end <= src_start {
                output.push(input[src_start.min(input.len() - 1)]);
                continue;
            }
            let count = (src_end - src_start) as f32;
            let sum: f32 = input[src_start..src_end].iter().sum();
            output.push(sum / count);
        }
    } else {
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
        let input: Vec<f32> = (0..4800).map(|i| (i as f32).sin()).collect();
        let out = resample(&input, 48000, 16000);
        assert_eq!(out.len(), 1600);
    }

    #[test]
    fn resample_preserves_dc_signal() {
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
