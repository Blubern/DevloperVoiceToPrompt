mod bridge;
mod paths;
pub mod types;

pub use bridge::CopilotState;
pub use types::{CopilotAuthStatus, CopilotModel};

use bridge::{bridge_call, bridge_call_with_params, is_transport_error};
use paths::bridge_paths;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Initialize the Copilot SDK by spawning the Node.js bridge process.
#[tauri::command]
pub async fn copilot_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    // Take the old bridge out of the lock first, then tear it down outside the lock.
    // This minimizes lock duration so concurrent commands aren't blocked during teardown.
    let old_bridge = {
        let mut guard = state.bridge.lock().await;
        guard.take()
    };

    // Tear down old bridge outside the lock
    if let Some(mut old) = old_bridge {
        old.stderr_task.abort();
        let _ = old.stdin.shutdown().await;
        let _ = old._child.kill().await;
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            old._child.wait(),
        ).await;
    }

    let (script, project_root) = bridge_paths(&app)?;

    let mut cmd = tokio::process::Command::new("node");
    cmd.arg(&script)
        .current_dir(&project_root)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    // macOS GUI apps don't inherit the user's login-shell PATH, so tools installed
    // via Homebrew (node, gh, etc.) won't be found. Query the login shell for its
    // full PATH and forward it to the child process.
    #[cfg(target_os = "macos")]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = std::process::Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            let path = String::from_utf8_lossy(&output.stdout);
            let path = path.trim();
            if !path.is_empty() {
                cmd.env("PATH", path);
            }
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn bridge: {}", e))?;

    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => { let _ = child.kill().await; return Err("No stdin on bridge process".into()); }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => { let _ = child.kill().await; return Err("No stdout on bridge process".into()); }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => { let _ = child.kill().await; return Err("No stderr on bridge process".into()); }
    };

    // Spawn a background task to continuously read and log stderr from the bridge
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break, // EOF — process exited
                Ok(_) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        tracing::warn!(source = "copilot-bridge", "{}", trimmed);
                    }
                }
                Err(e) => {
                    tracing::error!(source = "copilot-bridge", "stderr read error: {}", e);
                    break;
                }
            }
        }
    });

    let mut new_bridge = bridge::BridgeProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
        stderr_task,
        next_id: 1,
    };

    // Send "init" to have the bridge create a CopilotClient and verify the connection
    bridge_call(&mut new_bridge, "init").await?;

    tracing::info!("Copilot bridge initialized");

    // Only hold the lock briefly to insert the new bridge
    let mut guard = state.bridge.lock().await;
    *guard = Some(new_bridge);
    Ok(())
}

/// Get the current authentication status.
#[tauri::command]
pub async fn copilot_auth_status(
    state: tauri::State<'_, CopilotState>,
) -> Result<CopilotAuthStatus, String> {
    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Copilot not connected. Click Connect first.")?;

    let val = match bridge_call(bridge, "auth_status").await {
        Ok(v) => v,
        Err(e) => {
            if is_transport_error(&e) {
                tracing::warn!("Clearing dead Copilot bridge after transport error");
                *guard = None;
            }
            return Err(e);
        }
    };

    Ok(CopilotAuthStatus {
        authenticated: val
            .get("authenticated")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        login: val
            .get("login")
            .and_then(|v| v.as_str())
            .map(String::from),
        host: val
            .get("host")
            .and_then(|v| v.as_str())
            .map(String::from),
        status_message: val
            .get("status_message")
            .and_then(|v| v.as_str())
            .map(String::from),
    })
}

/// List available models from the Copilot API.
#[tauri::command]
pub async fn copilot_list_models(
    state: tauri::State<'_, CopilotState>,
) -> Result<Vec<CopilotModel>, String> {
    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Copilot not connected. Click Connect first.")?;

    let val = match bridge_call(bridge, "list_models").await {
        Ok(v) => v,
        Err(e) => {
            if is_transport_error(&e) {
                tracing::warn!("Clearing dead Copilot bridge after transport error");
                *guard = None;
            }
            return Err(e);
        }
    };

    let models: Vec<CopilotModel> =
        serde_json::from_value(val).map_err(|e| format!("Failed to parse models: {}", e))?;
    Ok(models)
}

/// Stop the bridge process and clean up.
#[tauri::command]
pub async fn copilot_stop(state: tauri::State<'_, CopilotState>) -> Result<(), String> {
    let mut guard = state.bridge.lock().await;
    if let Some(mut bridge) = guard.take() {
        // Try a graceful stop; ignore errors if the process already exited
        let _ = bridge_call(&mut bridge, "stop").await;
        bridge.stderr_task.abort();
        let _ = bridge.stdin.shutdown().await;
        let _ = bridge._child.kill().await;
        // Wait for the process to actually exit (up to 5s) to avoid orphans
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            bridge._child.wait(),
        ).await;
    }
    Ok(())
}

/// Enhance a prompt using the Copilot chat API.
#[tauri::command]
pub async fn copilot_enhance(
    state: tauri::State<'_, CopilotState>,
    model_id: String,
    system_prompt: String,
    user_text: String,
    delete_session: bool,
) -> Result<String, String> {
    // Guard against excessively long inputs to limit token usage and
    // memory pressure in the Copilot bridge process.
    const MAX_TEXT_LEN: usize = 10_000;
    if user_text.len() > MAX_TEXT_LEN {
        return Err(format!(
            "user_text exceeds the {MAX_TEXT_LEN}-character limit ({} chars)",
            user_text.len()
        ));
    }
    if system_prompt.len() > MAX_TEXT_LEN {
        return Err(format!(
            "system_prompt exceeds the {MAX_TEXT_LEN}-character limit ({} chars)",
            system_prompt.len()
        ));
    }
    tracing::info!(model = %model_id, text_len = user_text.len(), delete_session, "Copilot enhance request");
    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Copilot not connected.")?;

    let params = serde_json::json!({
        "model": model_id,
        "system_prompt": system_prompt,
        "user_text": user_text,
        "delete_session": delete_session,
    });

    let val = match bridge_call_with_params(bridge, "enhance", Some(params)).await {
        Ok(v) => v,
        Err(e) => {
            if is_transport_error(&e) {
                tracing::warn!("Clearing dead Copilot bridge after transport error");
                *guard = None;
            }
            return Err(e);
        }
    };

    val.as_str()
        .map(|s| {
            tracing::info!(result_len = s.len(), "Copilot enhance completed");
            String::from(s)
        })
        .ok_or_else(|| {
            tracing::error!("Copilot enhance returned unexpected format");
            "Unexpected response format from enhance".to_string()
        })
}
