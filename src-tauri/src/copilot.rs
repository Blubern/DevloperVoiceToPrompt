use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

/// A running copilot-bridge.mjs process with its I/O handles.
struct BridgeProcess {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: AtomicU64,
}

pub struct CopilotState {
    bridge: Arc<Mutex<Option<BridgeProcess>>>,
}

impl Default for CopilotState {
    fn default() -> Self {
        Self {
            bridge: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Serialize)]
pub struct CopilotAuthStatus {
    pub authenticated: bool,
    pub login: Option<String>,
    pub host: Option<String>,
    pub status_message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CopilotModel {
    pub id: String,
    pub name: String,
    pub is_premium: bool,
    pub multiplier: f64,
}

#[derive(Deserialize)]
struct BridgeResponse {
    #[allow(dead_code)]
    id: u64,
    result: Option<serde_json::Value>,
    error: Option<String>,
}

/// Send a JSON request to the bridge and read the JSON response line.
/// Times out after 30 seconds to prevent hangs if the bridge freezes.
async fn bridge_call(
    bridge: &mut BridgeProcess,
    method: &str,
) -> Result<serde_json::Value, String> {
    bridge_call_with_params(bridge, method, None).await
}

/// Send a JSON request with optional params to the bridge and read the JSON response line.
/// Times out after 30 seconds to prevent hangs if the bridge freezes.
async fn bridge_call_with_params(
    bridge: &mut BridgeProcess,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    use tokio::time::{timeout, Duration};

    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
    let mut req = serde_json::json!({ "id": id, "method": method });
    if let Some(p) = params {
        req["params"] = p;
    }
    let mut line = serde_json::to_string(&req)
        .map_err(|e| format!("Failed to serialize bridge request: {e}"))?;
    line.push('\n');

    bridge
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to bridge: {}", e))?;
    bridge
        .stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush bridge stdin: {}", e))?;

    let mut buf = String::new();
    let _read_result = timeout(
        Duration::from_secs(30),
        bridge.stdout.read_line(&mut buf),
    )
    .await
    .map_err(|_| "Copilot bridge did not respond within 30 seconds".to_string())?
    .map_err(|e| format!("Failed to read from bridge: {}", e))?;

    if buf.is_empty() {
        tracing::error!("Bridge process exited unexpectedly (empty stdout)");
        return Err("Bridge process exited unexpectedly".into());
    }

    let resp: BridgeResponse =
        serde_json::from_str(&buf).map_err(|e| {
            let preview: String = buf.chars().take(200).collect();
            format!("Invalid bridge response: {e} — raw: {preview}")
        })?;

    if let Some(err) = resp.error {
        tracing::error!(method, error = %err, "Bridge returned error");
        return Err(err);
    }

    Ok(resp.result.unwrap_or(serde_json::Value::Null))
}

/// Strip the \\?\ extended-length prefix that canonicalize() adds on Windows.
fn clean_path(p: std::path::PathBuf) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") {
        std::path::PathBuf::from(&s[4..])
    } else {
        p
    }
}

/// Resolve the path to copilot-bridge.mjs and the project root (where node_modules lives).
fn bridge_paths(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), String> {
    // During dev the script lives at src-tauri/scripts/copilot-bridge.mjs
    // and node_modules is at the project root (one level above src-tauri).
    let resource = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource dir: {}", e))?
        .join("scripts")
        .join("copilot-bridge.mjs");
    if resource.exists() {
        let resource = clean_path(resource);
        let project_root = resource
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| "Cannot resolve project root from resource path".to_string())?
            .to_path_buf();
        return Ok((resource, project_root));
    }

    // Fallback: dev mode – walk from the executable to the source tree
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(tauri_dir) = exe.parent() {
        // target/debug/ -> src-tauri/
        let dev_path = tauri_dir
            .join("..") // target/
            .join("..") // src-tauri/
            .join("scripts")
            .join("copilot-bridge.mjs");
        let dev_path = clean_path(dev_path.canonicalize().unwrap_or(dev_path));
        if dev_path.exists() {
            // Project root is src-tauri/../ (i.e. two levels up from scripts/)
            let project_root = dev_path
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .ok_or_else(|| "Cannot resolve project root from dev path".to_string())?
                .to_path_buf();
            return Ok((dev_path, project_root));
        }
    }

    Err("copilot-bridge.mjs not found".into())
}

/// Initialize the Copilot SDK by spawning the Node.js bridge process.
#[tauri::command]
pub async fn copilot_init(
    app: tauri::AppHandle,
    state: tauri::State<'_, CopilotState>,
) -> Result<(), String> {
    let mut guard = state.bridge.lock().await;

    // If already running, tear down the old bridge
    if let Some(mut old) = guard.take() {
        let _ = old.stdin.shutdown().await;
        let _ = old._child.kill().await;
        // Wait for the process to actually exit (up to 5s) to avoid orphans
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
    tokio::spawn(async move {
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

    let mut bridge = BridgeProcess {
        _child: child,
        stdin,
        stdout: BufReader::new(stdout),
        next_id: AtomicU64::new(1),
    };

    // Send "init" to have the bridge create a CopilotClient and verify the connection
    bridge_call(&mut bridge, "init").await?;

    tracing::info!("Copilot bridge initialized");
    *guard = Some(bridge);
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

    let val = bridge_call(bridge, "auth_status").await?;

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

    let val = bridge_call(bridge, "list_models").await?;

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

    let val = bridge_call_with_params(bridge, "enhance", Some(params)).await?;

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
