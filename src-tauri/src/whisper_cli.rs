use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::process::{Child, Command};

// ---------------------------------------------------------------------------
// Server process management
// ---------------------------------------------------------------------------

/// Managed state holding the running whisper-server child process.
pub type WhisperServerState = Arc<Mutex<Option<WhisperServerProcess>>>;

/// Result from transcribe_via_server including inference timing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub inference_ms: u64,
}

/// Hardware info parsed from whisper-server stderr output.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WhisperHardwareInfo {
    /// Backend in use: "CUDA", "Metal", "CPU", or "Unknown"
    pub backend: String,
    /// Number of threads whisper-server is using
    pub n_threads: Option<u32>,
    /// Hardware concurrency (total threads available)
    pub n_threads_total: Option<u32>,
    /// SIMD/acceleration features detected (e.g. "AVX2", "NEON", "BLAS")
    pub accel_features: Vec<String>,
}

/// Parse whisper-server system_info line from stderr.
/// Example: "system_info: n_threads = 4 / 8 | AVX2 = 1 | NEON = 0 | BLAS = 1 | CUDA = 1 |"
fn parse_system_info(line: &str) -> Option<WhisperHardwareInfo> {
    if !line.contains("system_info:") {
        return None;
    }
    let mut info = WhisperHardwareInfo {
        backend: "CPU".into(),
        ..Default::default()
    };

    // Parse n_threads = X / Y
    if let Some(threads_part) = line.split("n_threads =").nth(1) {
        let threads_str = threads_part.split('|').next().unwrap_or("").trim();
        let parts: Vec<&str> = threads_str.split('/').map(|s| s.trim()).collect();
        if let Some(first) = parts.first() {
            info.n_threads = first.parse().ok();
        }
        if let Some(second) = parts.get(1) {
            info.n_threads_total = second.parse().ok();
        }
    }

    // Parse feature flags: KEY = 0|1
    let feature_flags = ["AVX", "AVX2", "AVX512", "NEON", "FP16_VA", "WASM_SIMD", "BLAS", "CUDA", "Metal"];
    for flag in &feature_flags {
        let pattern = format!("{flag} = ");
        if let Some(pos) = line.find(&pattern) {
            let val_start = pos + pattern.len();
            let val_char = line[val_start..].chars().next().unwrap_or('0');
            if val_char == '1' {
                info.accel_features.push(flag.to_string());
            }
        }
    }

    // Determine backend from features
    if info.accel_features.contains(&"CUDA".to_string()) {
        info.backend = "CUDA".into();
    } else if info.accel_features.contains(&"Metal".to_string()) {
        info.backend = "Metal".into();
    }

    Some(info)
}

pub struct WhisperServerProcess {
    child: Child,
    pub port: u16,
    pub model_name: String,
    /// Hardware info parsed from first inference stderr output.
    pub hardware_info: Arc<Mutex<Option<WhisperHardwareInfo>>>,
}

impl WhisperServerProcess {
    /// Send kill signal to the whisper-server child process.
    pub fn kill(&mut self) {
        if let Err(e) = self.child.start_kill() {
            tracing::warn!(port = self.port, error = %e, "Failed to kill whisper-server process");
        }
    }

    /// Kill and wait for the process to fully exit (up to timeout).
    pub async fn kill_and_wait(&mut self, timeout_ms: u64) {
        self.kill();
        let deadline = tokio::time::Instant::now()
            + tokio::time::Duration::from_millis(timeout_ms);
        while tokio::time::Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => {
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
                Err(_) => return,
            }
        }
        tracing::warn!(port = self.port, "whisper-server did not exit within {timeout_ms}ms after kill");
    }

    /// Check if the process has exited. Returns `Some(status)` if dead, `None` if still running.
    pub fn try_wait(&mut self) -> Result<Option<std::process::ExitStatus>, std::io::Error> {
        self.child.try_wait()
    }
}

impl Drop for WhisperServerProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Find an available TCP port by binding to port 0.
pub fn find_available_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to find available port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// Start the whisper-server process.
pub async fn start_server(
    server_path: &Path,
    model_path: &Path,
    model_name: &str,
    language: &str,
    use_gpu: bool,
    port: u16,
) -> Result<WhisperServerProcess, String> {
    if !server_path.exists() {
        return Err(format!(
            "whisper-server binary not found at {}",
            server_path.display()
        ));
    }
    if !model_path.exists() {
        return Err(format!(
            "Model file not found at {}",
            model_path.display()
        ));
    }

    // Extract ISO 639-1 code from BCP47 (e.g. "en-US" → "en")
    let base_lang = language.split('-').next().unwrap_or(language);

    let mut cmd = Command::new(server_path);
    cmd.args([
        "--model",
        &model_path.to_string_lossy(),
        "--host",
        "127.0.0.1",
        "--port",
        &port.to_string(),
        "--language",
        base_lang,
        "--no-timestamps",
        // Suppress non-speech tokens for cleaner output
        "--suppress-nst",
    ]);

    if !use_gpu {
        cmd.arg("--no-gpu");
    }

    // Capture stderr so we can parse system_info for hardware detection.
    // stdout is unused by whisper-server; stdin not needed.
    cmd.stdout(Stdio::null())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    // On Windows, prevent the child from creating a visible console window
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper-server: {e}"))?;

    // On Windows, assign the child to a Job Object so it's killed automatically
    // if the parent process crashes or is force-killed.
    #[cfg(target_os = "windows")]
    {
        if let Err(e) = assign_child_to_job(child.id()) {
            tracing::warn!(error = %e, "Failed to assign whisper-server to job object; orphan possible on crash");
        }
    }

    tracing::info!(
        port = port,
        model = model_name,
        "Spawned whisper-server process"
    );

    let hardware_info: Arc<Mutex<Option<WhisperHardwareInfo>>> = Arc::new(Mutex::new(None));

    // Spawn a background task to read stderr and parse system_info
    let hw_info_clone = hardware_info.clone();
    let stderr = child.stderr.take();
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(info) = parse_system_info(&line) {
                    tracing::info!(backend = %info.backend, ?info.accel_features, "Parsed whisper-server hardware info");
                    if let Ok(mut guard) = hw_info_clone.lock() {
                        *guard = Some(info);
                    }
                    // Keep reading to prevent stderr buffer from filling up
                }
            }
        });
    }

    let mut process = WhisperServerProcess {
        child,
        port,
        model_name: model_name.to_string(),
        hardware_info,
    };

    // Poll until the server is ready (max 15 seconds)
    let url = format!("http://127.0.0.1:{port}/inference");
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "Failed to create HTTP client; killing spawned server");
            process.kill();
            return Err(format!("Failed to create HTTP client: {e}"));
        }
    };

    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(15);
    let mut ready = false;

    while tokio::time::Instant::now() < deadline {
        // Check if the process has exited prematurely
        match process.child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "whisper-server exited prematurely with status: {status}"
                ));
            }
            Ok(None) => {} // still running
            Err(e) => return Err(format!("Failed to check server process: {e}")),
        }

        // Try a lightweight request to see if server is accepting connections
        match client.get(&url).send().await {
            Ok(_) => {
                ready = true;
                break;
            }
            Err(_) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
            }
        }
    }

    if !ready {
        tracing::warn!(port = port, model = model_name, "whisper-server did not become ready within 15 seconds; killing");
        process.kill();
        return Err("whisper-server did not become ready within 15 seconds".into());
    }

    tracing::info!(port = port, "whisper-server is ready");
    Ok(process)
}

/// Transcribe audio via HTTP POST to the running whisper-server.
/// Returns both the text and the server-side inference time in milliseconds.
pub async fn transcribe_via_server(
    port: u16,
    wav_bytes: Vec<u8>,
    initial_prompt: Option<&str>,
) -> Result<TranscriptionResult, String> {
    let url = format!("http://127.0.0.1:{port}/inference");

    let mut form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(wav_bytes)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("Failed to create multipart: {e}"))?,
        )
        .text("temperature", "0.0")
        .text("temperature_inc", "0.2")
        .text("response_format", "json");

    if let Some(prompt) = initial_prompt {
        if !prompt.is_empty() {
            form = form.text("prompt", prompt.to_string());
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let t0 = std::time::Instant::now();

    let resp = client
        .post(&url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Transcription request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "whisper-server returned {status}: {body}"
        ));
    }

    // Parse JSON response: { "text": "..." }
    let body: serde_json::Value = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse server response: {e}"))?;

    let inference_ms = t0.elapsed().as_millis() as u64;
    let text = body["text"].as_str().unwrap_or("");
    Ok(TranscriptionResult {
        text: strip_hallucinations(text),
        inference_ms,
    })
}

// ---------------------------------------------------------------------------
// WAV writer (PCM f32 → 16-bit PCM WAV in memory)
// ---------------------------------------------------------------------------

/// Convert f32 PCM samples to a 16-bit PCM WAV file in memory.
pub fn write_wav_16bit(pcm_f32: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_samples = pcm_f32.len();
    let data_size = (num_samples * 2) as u32; // 16-bit = 2 bytes per sample
    let file_size = 36 + data_size; // RIFF header + data
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let byte_rate = sample_rate * (channels as u32) * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);

    let mut buf = Vec::with_capacity(44 + num_samples * 2);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt subchunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes()); // subchunk size
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    buf.extend_from_slice(&channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());

    // Convert f32 [-1.0, 1.0] → i16
    for &sample in pcm_f32 {
        let clamped = sample.clamp(-1.0, 1.0);
        let i16_val = (clamped * 32767.0) as i16;
        buf.extend_from_slice(&i16_val.to_le_bytes());
    }

    buf
}

// ---------------------------------------------------------------------------
// Hallucination stripping (reused from old whisper.rs)
// ---------------------------------------------------------------------------

/// Strip known Whisper hallucination tokens from raw transcription output
/// and whitespace-normalize the result.
pub fn strip_hallucinations(text: &str) -> String {
    let cleaned = text
        .replace("[BLANK_AUDIO]", "")
        .replace("[MUSIC]", "")
        .replace("[SILENCE]", "")
        .replace("(silence)", "")
        .replace("(blank audio)", "");
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------
// GPU detection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub has_nvidia: bool,
    pub gpu_name: Option<String>,
    pub cuda_version: Option<String>,
    pub recommended_variant: String,
}

/// Detect NVIDIA GPU by running nvidia-smi (Windows/Linux).
/// On macOS, checks for Apple Silicon (Metal).
pub fn detect_gpu() -> GpuInfo {
    #[cfg(target_os = "macos")]
    {
        // Apple Silicon Macs have Metal support via Homebrew whisper-cpp build
        let is_arm = std::env::consts::ARCH == "aarch64";
        return GpuInfo {
            has_nvidia: false,
            gpu_name: if is_arm {
                Some("Apple Silicon (Metal)".into())
            } else {
                None
            },
            cuda_version: None,
            recommended_variant: if is_arm {
                "homebrew".into()
            } else {
                "cpu".into()
            },
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        let output = std::process::Command::new("nvidia-smi")
            .args([
                "--query-gpu=driver_version,name,memory.total",
                "--format=csv,noheader,nounits",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                let parts: Vec<&str> = text.trim().splitn(3, ", ").collect();
                let driver_version = parts.first().unwrap_or(&"").to_string();
                let gpu_name = parts.get(1).map(|s| s.to_string());

                // Determine recommended CUDA variant from driver version
                // Driver ≥ 525 supports CUDA 12.x; older → CUDA 11.8
                let major_driver: u32 = driver_version
                    .split('.')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);

                let recommended = if major_driver >= 525 {
                    "cuda-12.4"
                } else if major_driver > 0 {
                    "cuda-11.8"
                } else {
                    "cpu"
                };

                GpuInfo {
                    has_nvidia: true,
                    gpu_name,
                    cuda_version: Some(driver_version),
                    recommended_variant: recommended.into(),
                }
            }
            _ => GpuInfo {
                has_nvidia: false,
                gpu_name: None,
                cuda_version: None,
                recommended_variant: "cpu".into(),
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Model definitions (reused from old whisper.rs)
// ---------------------------------------------------------------------------

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

/// Directory where GGML models are stored.
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
    if !WHISPER_MODELS
        .iter()
        .any(|(name, _, _)| *name == model_name)
    {
        return Err(format!("Unknown model: {model_name}"));
    }
    Ok(models_dir(app)?.join(format!("ggml-{model_name}.bin")))
}

/// HuggingFace download URL for a model.
pub fn model_download_url(model_name: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model_name}.bin")
}

use tauri::Manager;

// ---------------------------------------------------------------------------
// CLI binary management
// ---------------------------------------------------------------------------

/// CLI variant definitions for Windows.
/// Each entry: (variant_id, display_label, github_release_asset_name, approx_size_mb)
pub const CLI_VARIANTS: &[(&str, &str, &str, u64)] = &[
    ("cpu", "CPU", "whisper-bin-x64.zip", 4),
    ("blas", "OpenBLAS", "whisper-blas-bin-x64.zip", 16),
    ("cuda-11.8", "CUDA 11.8", "whisper-cublas-11.8.0-bin-x64.zip", 62),
    ("cuda-12.4", "CUDA 12.4", "whisper-cublas-12.4.0-bin-x64.zip", 460),
];

/// Default whisper.cpp release version.
#[allow(dead_code)]
pub const DEFAULT_CLI_VERSION: &str = "1.8.3";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct CliVariantInfo {
    pub id: String,
    pub label: String,
    pub size_mb: u64,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub variant: Option<String>,
    pub source: String, // "download", "homebrew", "manual"
    pub path: Option<String>,
}

/// Directory where the CLI binary is stored.
pub fn cli_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;
    let dir = data_dir.join("whisper-cli");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create CLI directory: {e}"))?;
    }
    Ok(dir)
}

/// The expected server executable name.
fn server_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "whisper-server.exe"
    } else {
        "whisper-server"
    }
}

#[cfg(target_os = "macos")]
fn first_existing_path(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "macos")]
fn brew_prefix_candidates() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();

    for args in [&["--prefix", "whisper-cpp"] as &[&str], &["--prefix"]] {
        if let Ok(output) = std::process::Command::new("brew").args(args).output() {
            if output.status.success() {
                let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !prefix.is_empty() {
                    prefixes.push(PathBuf::from(prefix));
                }
            }
        }
    }

    prefixes
}

#[cfg(target_os = "macos")]
fn macos_homebrew_server_path() -> Option<PathBuf> {
    let binary_name = server_binary_name();
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin").join(binary_name),
        PathBuf::from("/usr/local/bin").join(binary_name),
    ];

    for prefix in brew_prefix_candidates() {
        candidates.push(prefix.join("bin").join(binary_name));
    }

    first_existing_path(candidates)
}

/// Get path to whisper-server, checking:
/// 1. Downloaded binary in cli_dir
/// 2. Homebrew (macOS): which whisper-server
/// 3. System PATH
pub fn find_server_executable(app: &tauri::AppHandle) -> Result<CliStatus, String> {
    // 1. Check downloaded binary
    if let Ok(dir) = cli_dir(app) {
        let local_path = dir.join(server_binary_name());
        if local_path.exists() {
            // Read variant from marker file
            let variant = std::fs::read_to_string(dir.join(".variant")).ok();
            let version = std::fs::read_to_string(dir.join(".version")).ok();
            return Ok(CliStatus {
                installed: true,
                version: version.map(|v| v.trim().to_string()),
                variant: variant.map(|v| v.trim().to_string()),
                source: "download".into(),
                path: Some(local_path.to_string_lossy().to_string()),
            });
        }
    }

    // 2. Check system PATH / Homebrew locations
    let binary_name = server_binary_name();

    #[cfg(target_os = "macos")]
    {
        if let Some(path) = macos_homebrew_server_path() {
            return Ok(CliStatus {
                installed: true,
                version: None,
                variant: None,
                source: "homebrew".into(),
                path: Some(path.to_string_lossy().to_string()),
            });
        }

        if let Ok(output) = std::process::Command::new("which")
            .arg(binary_name)
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(CliStatus {
                        installed: true,
                        version: None,
                        variant: None,
                        source: "homebrew".into(),
                        path: Some(path),
                    });
                }
            }
        }
    }

    // Windows: use where.exe; Unix: use which
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("where.exe")
            .arg(binary_name)
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() {
                    return Ok(CliStatus {
                        installed: true,
                        version: None,
                        variant: None,
                        source: "manual".into(),
                        path: Some(path),
                    });
                }
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(output) = std::process::Command::new("which")
            .arg(binary_name)
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(CliStatus {
                        installed: true,
                        version: None,
                        variant: None,
                        source: "manual".into(),
                        path: Some(path),
                    });
                }
            }
        }
    }

    Ok(CliStatus {
        installed: false,
        version: None,
        variant: None,
        source: "none".into(),
        path: None,
    })
}

/// Get the server executable path (local download or system).
pub fn server_executable_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let status = find_server_executable(app)?;
    if status.installed {
        Ok(PathBuf::from(
            status.path.ok_or("Server path missing")?,
        ))
    } else {
        Err("whisper-server not installed. Download it from Settings → Speech → Whisper.".into())
    }
}

/// Build the GitHub release asset download URL.
/// On macOS, returns an error directing users to Homebrew (no pre-built macOS binaries in releases).
pub fn cli_download_url(version: &str, variant: &str) -> Result<String, String> {
    if cfg!(target_os = "macos") {
        return Err(
            "Pre-built binaries are not available for macOS. \
             Install via Homebrew instead: brew install whisper-cpp"
                .into(),
        );
    }

    let asset_name = CLI_VARIANTS
        .iter()
        .find(|(id, _, _, _)| *id == variant)
        .map(|(_, _, asset, _)| *asset)
        .ok_or_else(|| format!("Unknown CLI variant: {variant}"))?;

    Ok(format!(
        "https://github.com/ggml-org/whisper.cpp/releases/download/v{version}/{asset_name}"
    ))
}

// ---------------------------------------------------------------------------
// Windows Job Object — kill child processes when parent dies
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn assign_child_to_job(child_pid: Option<u32>) -> Result<(), String> {
    use std::os::windows::io::FromRawHandle;

    // Windows API constants
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: u32 = 9;
    const PROCESS_ALL_ACCESS: u32 = 0x1FFFFF;

    #[repr(C)]
    #[derive(Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimitInformation {
        basic: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    extern "system" {
        fn CreateJobObjectW(attrs: *mut u8, name: *const u16) -> *mut std::ffi::c_void;
        fn SetInformationJobObject(
            job: *mut std::ffi::c_void,
            class: u32,
            info: *const u8,
            len: u32,
        ) -> i32;
        fn AssignProcessToJobObject(
            job: *mut std::ffi::c_void,
            process: *mut std::ffi::c_void,
        ) -> i32;
        fn OpenProcess(
            access: u32,
            inherit: i32,
            pid: u32,
        ) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }

    let pid = child_pid.ok_or("Child process has no PID")?;

    unsafe {
        // Create an anonymous Job Object
        let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
        if job.is_null() {
            return Err("CreateJobObjectW failed".into());
        }

        // Configure: kill all processes when the job handle is closed
        let mut info = ExtendedLimitInformation::default();
        info.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        if SetInformationJobObject(
            job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            &info as *const _ as *const u8,
            std::mem::size_of::<ExtendedLimitInformation>() as u32,
        ) == 0
        {
            CloseHandle(job);
            return Err("SetInformationJobObject failed".into());
        }

        // Open the child process and assign it
        let process = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
        if process.is_null() {
            CloseHandle(job);
            return Err(format!("OpenProcess failed for PID {pid}"));
        }

        let result = AssignProcessToJobObject(job, process);
        CloseHandle(process);

        if result == 0 {
            CloseHandle(job);
            return Err("AssignProcessToJobObject failed".into());
        }

        // Intentionally leak the job handle — it must stay open for the
        // lifetime of the parent process. When the parent exits (even via
        // crash or taskkill), the OS closes the handle and all assigned
        // child processes are terminated.
        std::mem::forget(std::os::windows::io::OwnedHandle::from_raw_handle(job as _));

        tracing::debug!(pid = pid, "Assigned whisper-server to job object");
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_models_has_entries() {
        assert!(WHISPER_MODELS.len() >= 4);
    }

    #[test]
    fn whisper_models_names_unique() {
        let mut names: Vec<&str> = WHISPER_MODELS.iter().map(|(n, _, _)| *n).collect();
        let count = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), count);
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
    fn hallucination_tokens_stripped() {
        let input = "[BLANK_AUDIO] hello [MUSIC] world [SILENCE] (silence) (blank audio)";
        let result = strip_hallucinations(input);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn wav_header_valid() {
        let pcm = vec![0.0f32; 16000]; // 1s of silence at 16kHz
        let wav = write_wav_16bit(&pcm, 16000);

        // Check RIFF header
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");

        // File size: 44 header + 32000 data bytes
        assert_eq!(wav.len(), 44 + 16000 * 2);
    }

    #[test]
    fn wav_sample_conversion() {
        let pcm = vec![1.0, -1.0, 0.0, 0.5, -0.5];
        let wav = write_wav_16bit(&pcm, 16000);
        // Data starts at byte 44
        let data = &wav[44..];
        assert_eq!(data.len(), 10); // 5 samples × 2 bytes

        let s0 = i16::from_le_bytes([data[0], data[1]]);
        let s1 = i16::from_le_bytes([data[2], data[3]]);
        let s2 = i16::from_le_bytes([data[4], data[5]]);
        assert_eq!(s0, 32767); // 1.0 → max positive
        assert_eq!(s1, -32767); // -1.0 → max negative (not -32768 due to asymmetric clamping)
        assert_eq!(s2, 0); // 0.0 → 0
    }

    #[test]
    fn cli_download_url_cpu() {
        let url = cli_download_url("1.8.3", "cpu").unwrap();
        assert_eq!(
            url,
            "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip"
        );
    }

    #[test]
    fn cli_download_url_cuda() {
        let url = cli_download_url("1.8.3", "cuda-12.4").unwrap();
        assert!(url.contains("whisper-cublas-12.4.0-bin-x64.zip"));
    }

    #[test]
    fn cli_download_url_unknown_variant() {
        assert!(cli_download_url("1.8.3", "vulkan").is_err());
    }

    #[test]
    fn cli_variants_unique() {
        let mut ids: Vec<&str> = CLI_VARIANTS.iter().map(|(id, _, _, _)| *id).collect();
        let count = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }

    #[test]
    fn find_available_port_succeeds() {
        let port = find_available_port().unwrap();
        assert!(port > 0);
    }

    #[test]
    fn detect_gpu_does_not_panic() {
        // Just ensure it doesn't crash — result depends on hardware
        let _ = detect_gpu();
    }
}
