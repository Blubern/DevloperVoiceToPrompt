mod bridge;
mod paths;
pub mod types;

pub use bridge::CopilotState;
pub use types::{CopilotAuthStatus, CopilotModel};

use bridge::{bridge_call, bridge_call_with_params, is_transport_error};
use paths::bridge_paths;

use tokio::io::{AsyncBufReadExt, BufReader};

/// Lazily spawn a bridge process if one isn't already running.
/// The bridge is a lightweight JSONL relay that stays alive;
/// the CopilotClient inside it is created per-call (issue #4).
async fn ensure_bridge(
    app: &tauri::AppHandle,
    state: &CopilotState,
) -> Result<(), String> {
    let mut guard = state.bridge.lock().await;
    if let Some(ref mut b) = *guard {
        if b.is_alive() {
            return Ok(());
        }
        tracing::warn!("Clearing dead bridge before respawn");
        *guard = None;
    }

    let config = bridge_paths(app).map_err(|e| {
        tracing::error!("bridge_paths failed: {}", e);
        e
    })?;

    let node_exe = config
        .node_bin
        .as_deref()
        .unwrap_or(std::path::Path::new("node"));
    if config.node_bin.is_some() {
        tracing::info!("Using bundled Node.js at {:?}", node_exe);
    } else {
        tracing::info!("Using system Node.js");
    }

    let mut cmd = tokio::process::Command::new(node_exe);
    cmd.arg(&config.script)
        .current_dir(&config.work_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    cmd.env("NODE_PATH", &config.work_dir);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

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

    let mut child = cmd.spawn().map_err(|e| {
        let msg = format!("Failed to spawn bridge: {}", e);
        tracing::error!("{}", msg);
        msg
    })?;

    let stdin = child.stdin.take().ok_or("No stdin on bridge process")?;
    let stdout = child.stdout.take().ok_or("No stdout on bridge process")?;
    let stderr = child.stderr.take().ok_or("No stderr on bridge process")?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
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

    *guard = Some(bridge::BridgeProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
        _stderr_task: stderr_task,
        next_id: 1,
    });

    tracing::info!("Copilot bridge process spawned");
    Ok(())
}

/// Get the current authentication status.
#[tauri::command]
pub async fn copilot_auth_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<CopilotAuthStatus, String> {
    ensure_bridge(&app, &state).await?;

    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Bridge not available")?;

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
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<Vec<CopilotModel>, String> {
    ensure_bridge(&app, &state).await?;

    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Bridge not available")?;

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
        serde_json::from_value(val).map_err(|e| {
            tracing::error!("copilot_list_models: failed to parse response: {}", e);
            format!("Failed to parse models: {}", e)
        })?;
    Ok(models)
}

/// Enhance a prompt using the Copilot chat API.
#[tauri::command]
pub async fn copilot_enhance(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
    model_id: String,
    system_prompt: String,
    user_text: String,
) -> Result<String, String> {
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
    tracing::info!(model = %model_id, text_len = user_text.len(), "Copilot enhance request");

    ensure_bridge(&app, &state).await?;

    let mut guard = state.bridge.lock().await;
    let bridge = guard
        .as_mut()
        .ok_or("Bridge not available")?;

    let params = serde_json::json!({
        "model": model_id,
        "system_prompt": system_prompt,
        "user_text": user_text,
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
