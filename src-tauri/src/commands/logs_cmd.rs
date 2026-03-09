use std::fs;

/// Returns true if the file name belongs to a log file ("app.log" prefix).
fn is_log_file(entry: &fs::DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .map(|name| name.starts_with("app.log"))
        .unwrap_or(false)
}

/// Read log file contents, returning the most recent `max_lines` lines.
/// Reads files from newest to oldest and stops early once enough lines are collected.
#[tauri::command]
pub async fn get_logs(app: tauri::AppHandle, max_lines: Option<usize>) -> Result<String, String> {
    let dir = crate::logging::log_dir(&app);
    let max = max_lines.unwrap_or(500);

    // Collect all log files sorted by name (date-based names sort chronologically)
    let mut log_files: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read log directory: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| is_log_file(e))
        .collect();

    log_files.sort_by_key(|e| e.file_name());

    // Read from newest file backward, collecting lines in reverse.
    // Stop early once we have enough lines.
    use std::io::{BufRead, BufReader};

    let mut collected: Vec<String> = Vec::with_capacity(max);

    for entry in log_files.iter().rev() {
        if collected.len() >= max {
            break;
        }
        let file = match fs::File::open(entry.path()) {
            Ok(f) => f,
            Err(_) => continue,
        };
        // Read all lines from this file, then take the tail we still need.
        let file_lines: Vec<String> = BufReader::new(file)
            .lines()
            .filter_map(|l| l.ok())
            .collect();

        let remaining = max - collected.len();
        let start = file_lines.len().saturating_sub(remaining);
        // Prepend this file's lines (they go before what we already have since
        // we're iterating newest-first but want chronological output).
        let mut batch: Vec<String> = file_lines[start..].to_vec();
        batch.append(&mut collected);
        collected = batch;
    }

    Ok(collected.join("\n"))
}

/// Delete all log files.
#[tauri::command]
pub async fn clear_logs(app: tauri::AppHandle) -> Result<(), String> {
    let dir = crate::logging::log_dir(&app);

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read log directory: {e}"))?;

    for entry in entries.flatten() {
        if is_log_file(&entry) {
            let _ = fs::remove_file(entry.path());
        }
    }

    Ok(())
}

/// Get the path to the log directory (for display in UI).
#[tauri::command]
pub async fn get_log_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = crate::logging::log_dir(&app);
    Ok(dir.to_string_lossy().to_string())
}

/// Opens the log folder in the system file explorer (Explorer on Windows, Finder on macOS).
#[tauri::command]
pub async fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = crate::logging::log_dir(&app);

    let _ = fs::create_dir_all(&dir);

    let path_str = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&path_str, None::<&str>)
        .map_err(|e| format!("Failed to open log directory: {e}"))?;

    Ok(())
}
