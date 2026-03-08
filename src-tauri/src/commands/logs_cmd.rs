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

    // Read files in reverse, collecting only the last `max` lines via a bounded ring
    use std::collections::VecDeque;
    use std::io::{BufRead, BufReader};

    let mut ring: VecDeque<String> = VecDeque::with_capacity(max);
    for entry in &log_files {
        let file = match fs::File::open(entry.path()) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for line in BufReader::new(file).lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => continue,
            };
            if ring.len() == max {
                ring.pop_front();
            }
            ring.push_back(line);
        }
    }

    Ok(ring.into_iter().collect::<Vec<_>>().join("\n"))
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
