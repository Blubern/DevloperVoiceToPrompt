use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, EnvFilter};

/// Returns the log directory inside the app's data folder.
pub fn log_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("DeveloperVoiceToPrompt"));
    // Ensure the directory exists
    let _ = fs::create_dir_all(&base);
    base
}

/// Initialise file-based tracing. Returns a guard that must be kept alive
/// for the lifetime of the application (dropping it flushes the writer).
pub fn init_tracing(app: &tauri::AppHandle) -> WorkerGuard {
    let dir = log_dir(app);

    let file_appender = tracing_appender::rolling::daily(&dir, "app.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .init();

    guard
}

/// Delete log files older than `max_age_days`.
pub fn cleanup_old_logs(app: &tauri::AppHandle, max_age_days: u64) {
    let dir = log_dir(app);
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_log = entry
            .file_name()
            .to_str()
            .map(|name| name.starts_with("app.log"))
            .unwrap_or(false);
        if !is_log {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}
