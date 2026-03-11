use tauri::Emitter;

use crate::whisper_cli;

#[tauri::command]
pub async fn whisper_download_model(
    app: tauri::AppHandle,
    model_name: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let path = whisper_cli::model_file_path(&app, &model_name)?;
    if path.exists() {
        return Ok(());
    }

    let url = whisper_cli::model_download_url(&model_name);
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

    // Write to a uniquely-named temp file to avoid corruption from concurrent downloads
    let tmp_name = format!("ggml-{}.{}.bin.tmp", model_name, std::process::id());
    let tmp_path = path.parent().unwrap().join(tmp_name);
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut stream = resp.bytes_stream();

    let result = (|| async {
        let mut last_pct: u64 = u64::MAX;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write model data: {e}"))?;
            downloaded += chunk.len() as u64;

            let pct = if total_size > 0 { downloaded * 100 / total_size } else { 0 };
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "whisper-download-progress",
                    serde_json::json!({
                        "model": model_name,
                        "downloaded": downloaded,
                        "total": total_size,
                    }),
                );
            }
        }

        file.flush().await.map_err(|e| format!("Failed to flush file: {e}"))?;
        drop(file);

        tokio::fs::rename(&tmp_path, &path)
            .await
            .map_err(|e| format!("Failed to finalize model file: {e}"))?;

        Ok::<(), String>(())
    })().await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    result
}

#[tauri::command]
pub fn whisper_delete_model(
    app: tauri::AppHandle,
    state: tauri::State<'_, whisper_cli::WhisperServerState>,
    model_name: String,
) -> Result<(), String> {
    tracing::info!(model = %model_name, "Deleting Whisper model");

    // Prevent deletion of the model currently loaded by the running server
    {
        let guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(proc) = guard.as_ref() {
            if proc.model_name == model_name {
                return Err("Stop the whisper-server before deleting the active model.".into());
            }
        }
    }

    let path = whisper_cli::model_file_path(&app, &model_name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// CLI binary download / delete
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn whisper_download_cli(
    app: tauri::AppHandle,
    version: String,
    variant: String,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let url = whisper_cli::cli_download_url(&version, &variant)?;
    let dir = whisper_cli::cli_dir(&app)?;

    tracing::info!(version = %version, variant = %variant, "Downloading whisper CLI");

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("CLI download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("CLI download failed with status: {}", resp.status()));
    }

    let total_size = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Download ZIP to temp file
    let tmp_path = dir.join(format!("whisper-cli-{}.zip.tmp", std::process::id()));
    let zip_path = dir.join("whisper-cli.zip");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut stream = resp.bytes_stream();

    let download_result = (|| async {
        let mut last_pct: u64 = u64::MAX;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write CLI data: {e}"))?;
            downloaded += chunk.len() as u64;

            let pct = if total_size > 0 { downloaded * 100 / total_size } else { 0 };
            if pct != last_pct {
                last_pct = pct;
                let _ = app.emit(
                    "whisper-cli-download-progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total_size,
                    }),
                );
            }
        }

        file.flush().await.map_err(|e| format!("Failed to flush file: {e}"))?;
        drop(file);

        tokio::fs::rename(&tmp_path, &zip_path)
            .await
            .map_err(|e| format!("Failed to finalize ZIP file: {e}"))?;

        Ok::<(), String>(())
    })().await;

    if download_result.is_err() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return download_result;
    }

    // Extract ZIP on blocking thread
    let dir_clone = dir.clone();
    let zip_path_clone = zip_path.clone();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path_clone)
            .map_err(|e| format!("Failed to open ZIP: {e}"))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read ZIP archive: {e}"))?;

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry: {e}"))?;

            // Only extract files (skip directories), and sanitize the name
            if entry.is_dir() {
                continue;
            }

            let file_name = entry
                .enclosed_name()
                .and_then(|p| p.file_name().map(|n| n.to_os_string()))
                .ok_or_else(|| "Invalid ZIP entry name".to_string())?;

            let out_path = dir_clone.join(&file_name);
            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| format!("Failed to create {}: {e}", file_name.to_string_lossy()))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Failed to extract {}: {e}", file_name.to_string_lossy()))?;

            // Set executable permission on Unix
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let name_str = file_name.to_string_lossy();
                if name_str.contains("whisper-server") || name_str.contains("whisper-cli") {
                    if let Err(e) = std::fs::set_permissions(
                        &out_path,
                        std::fs::Permissions::from_mode(0o755),
                    ) {
                        tracing::warn!(file = %name_str, error = %e, "Failed to set executable permission");
                    }
                }
            }
        }

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Extract task error: {e}"))??;

    // Clean up ZIP
    let _ = tokio::fs::remove_file(&zip_path).await;

    // Write version and variant marker files
    if let Err(e) = tokio::fs::write(dir.join(".version"), version.as_bytes()).await {
        tracing::warn!(error = %e, "Failed to write CLI version marker");
    }
    if let Err(e) = tokio::fs::write(dir.join(".variant"), variant.as_bytes()).await {
        tracing::warn!(error = %e, "Failed to write CLI variant marker");
    }

    // macOS: remove quarantine attribute
    #[cfg(target_os = "macos")]
    {
        let dir_str = dir.to_string_lossy().to_string();
        match tokio::process::Command::new("xattr")
            .args(["-cr", &dir_str])
            .output()
            .await
        {
            Ok(output) if !output.status.success() => {
                tracing::warn!(
                    stderr = %String::from_utf8_lossy(&output.stderr),
                    "xattr failed to remove quarantine attribute"
                );
            }
            Err(e) => {
                tracing::warn!(error = %e, "Failed to run xattr to remove quarantine");
            }
            _ => {}
        }
    }

    tracing::info!("whisper CLI extracted successfully");
    Ok(())
}

#[tauri::command]
pub async fn whisper_delete_cli(
    app: tauri::AppHandle,
    state: tauri::State<'_, whisper_cli::WhisperServerState>,
) -> Result<(), String> {
    tracing::info!("Deleting whisper CLI binary");

    // Reject if server is still running — user must stop it first
    {
        let guard = state.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
        if guard.is_some() {
            return Err("Stop the whisper-server before deleting the CLI binary.".into());
        }
    }

    let dir = whisper_cli::cli_dir(&app)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to delete CLI directory: {e}"))?;
    }
    Ok(())
}
