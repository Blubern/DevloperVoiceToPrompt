mod bridge;
mod paths;
pub mod types;

pub use bridge::CopilotState;
pub use types::{CopilotAuthStatus, CopilotModel};

use bridge::{bridge_call, bridge_call_with_params, is_transport_error};
use paths::bridge_paths;

use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Payload emitted on the `copilot-bridge-state` event.
#[derive(Clone, serde::Serialize)]
struct BridgeStatePayload {
    connected: bool,
}

/// Emit the bridge connection state to all windows.
fn emit_bridge_state(app: &tauri::AppHandle, connected: bool) {
    if let Err(e) = app.emit("copilot-bridge-state", BridgeStatePayload { connected }) {
        tracing::warn!("Failed to emit copilot-bridge-state: {e}");
    }
}

/// Tear down an existing bridge process (kill child, abort stderr task).
async fn teardown_bridge(old: &mut bridge::BridgeProcess) {
    tracing::info!("Tearing down Copilot bridge process");
    old.stderr_task.abort();
    let _ = old.stdin.shutdown().await;
    let _ = old._child.kill().await;
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        old._child.wait(),
    )
    .await;
}

/// Spawn a new bridge process, send the "init" RPC, and return it.
async fn spawn_bridge(app: &tauri::AppHandle) -> Result<bridge::BridgeProcess, String> {
    let config = bridge_paths(app).map_err(|e| {
        tracing::error!("copilot_init: bridge_paths failed: {}", e);
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
        tracing::error!("copilot_init: {}", msg);
        msg
    })?;

    let stdin = match child.stdin.take() {
        Some(s) => s,
        None => {
            let _ = child.kill().await;
            return Err("No stdin on bridge process".into());
        }
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill().await;
            return Err("No stdout on bridge process".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = child.kill().await;
            return Err("No stderr on bridge process".into());
        }
    };

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

    let mut new_bridge = bridge::BridgeProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
        stderr_task,
        next_id: 1,
    };

    bridge_call(&mut new_bridge, "init").await.map_err(|e| {
        tracing::error!("copilot_init: bridge init call failed: {}", e);
        e
    })?;

    tracing::info!("Copilot bridge initialized");
    Ok(new_bridge)
}

/// Initialize the Copilot SDK by spawning the Node.js bridge process.
///
/// **Idempotent**: if a healthy bridge is already running, this is a no-op.
#[tauri::command]
pub async fn copilot_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    // Fast path: if a live bridge already exists, reuse it.
    {
        let mut guard = state.bridge.lock().await;
        if let Some(ref mut b) = *guard {
            if b.is_alive() {
                tracing::debug!("copilot_init: bridge already running, skipping respawn");
                return Ok(());
            }
            // Bridge exists but process is dead — clean up the stale entry.
            tracing::warn!("copilot_init: clearing dead bridge before respawn");
            *guard = None;
        }
    }

    let new_bridge = spawn_bridge(&app).await?;

    let mut guard = state.bridge.lock().await;
    *guard = Some(new_bridge);
    emit_bridge_state(&app, true);
    Ok(())
}

/// Force-restart the Copilot bridge: tear down any existing bridge and spawn a
/// fresh one.  Use this for explicit user-initiated reconnection.
#[tauri::command]
pub async fn copilot_restart(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    tracing::info!("copilot_restart: force-restarting bridge");
    // Take the old bridge out of the lock, tear it down outside the lock.
    let old_bridge = {
        let mut guard = state.bridge.lock().await;
        guard.take()
    };

    if let Some(mut old) = old_bridge {
        teardown_bridge(&mut old).await;
    }
    emit_bridge_state(&app, false);

    let new_bridge = spawn_bridge(&app).await?;

    let mut guard = state.bridge.lock().await;
    *guard = Some(new_bridge);
    emit_bridge_state(&app, true);
    tracing::info!("copilot_restart: bridge restarted successfully");
    Ok(())
}

/// Check whether the Copilot bridge process is currently alive.
#[tauri::command]
pub async fn copilot_is_connected(
    state: tauri::State<'_, CopilotState>,
) -> Result<bool, String> {
    let mut guard = state.bridge.lock().await;
    Ok(match *guard {
        Some(ref mut b) => b.is_alive(),
        None => false,
    })
}

/// Shut down the bridge without respawning.
#[tauri::command]
pub async fn copilot_disconnect(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    tracing::info!("copilot_disconnect: shutting down bridge");
    let mut guard = state.bridge.lock().await;
    if let Some(mut bridge) = guard.take() {
        let _ = bridge_call(&mut bridge, "stop").await;
        teardown_bridge(&mut bridge).await;
    }
    emit_bridge_state(&app, false);
    tracing::info!("copilot_disconnect: bridge shut down");
    Ok(())
}

/// Get the current authentication status.
#[tauri::command]
pub async fn copilot_auth_status(
    app: tauri::AppHandle,
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
                emit_bridge_state(&app, false);
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
                emit_bridge_state(&app, false);
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

/// Stop the bridge process and clean up.
#[tauri::command]
pub async fn copilot_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    tracing::info!("copilot_stop: stopping bridge");
    let mut guard = state.bridge.lock().await;
    if let Some(mut bridge) = guard.take() {
        let _ = bridge_call(&mut bridge, "stop").await;
        teardown_bridge(&mut bridge).await;
    }
    emit_bridge_state(&app, false);
    tracing::info!("copilot_stop: bridge stopped");
    Ok(())
}

/// Enhance a prompt using the Copilot chat API.
#[tauri::command]
pub async fn copilot_enhance(
    app: tauri::AppHandle,
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
                emit_bridge_state(&app, false);
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
