use tauri::Emitter;

use crate::whisper;

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

    let result = (|| async {
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

        Ok::<(), String>(())
    })().await;

    // Clean up temp file on error
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }

    result
}

#[tauri::command]
pub fn whisper_delete_model(app: tauri::AppHandle, model_name: String) -> Result<(), String> {
    let path = whisper::model_file_path(&app, &model_name)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete model: {e}"))?;
    }
    Ok(())
}
