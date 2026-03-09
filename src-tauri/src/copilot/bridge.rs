use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};

use super::types::BridgeResponse;

/// A running copilot-bridge.mjs process with its I/O handles.
pub(super) struct BridgeProcess {
    pub(super) _child: Child,
    pub(super) stdin: ChildStdin,
    pub(super) stdout: BufReader<ChildStdout>,
    pub(super) stderr_task: tokio::task::JoinHandle<()>,
    /// Monotonically increasing counter used to populate the JSON-RPC "id" field.
    ///
    /// IMPORTANT: Responses are matched **by position** (the next line read from
    /// stdout), NOT by correlating the response id with the request id.  This is
    /// correct only because all calls are serialised through a single
    /// `tokio::sync::Mutex`-guarded `&mut BridgeProcess` (one in-flight request
    /// at a time).  If you ever parallelise bridge calls you must switch to
    /// proper id-based demultiplexing.
    pub(super) next_id: u64,
}

/// Shared state holding the optional bridge process.
pub struct CopilotState {
    pub(super) bridge: Arc<Mutex<Option<BridgeProcess>>>,
}

impl Default for CopilotState {
    fn default() -> Self {
        Self {
            bridge: Arc::new(Mutex::new(None)),
        }
    }
}

/// Send a JSON request to the bridge and read the JSON response line.
/// Times out after 30 seconds to prevent hangs if the bridge freezes.
pub(crate) async fn bridge_call(
    bridge: &mut BridgeProcess,
    method: &str,
) -> Result<serde_json::Value, String> {
    bridge_call_with_params(bridge, method, None).await
}

/// Send a JSON request with optional params to the bridge and read the JSON response line.
/// Times out after 30 seconds to prevent hangs if the bridge freezes.
pub(crate) async fn bridge_call_with_params(
    bridge: &mut BridgeProcess,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    use tokio::time::{timeout, Duration};

    let id = bridge.next_id;
    bridge.next_id += 1;
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
        return Err("Bridge process exited unexpectedly (transport)".into());
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

/// Returns true when the error indicates the bridge process is dead and should
/// be cleared from shared state so the next call doesn't repeat the failure.
pub(crate) fn is_transport_error(err: &str) -> bool {
    err.contains("(transport)")
        || err.contains("Failed to write to bridge")
        || err.contains("Failed to flush bridge stdin")
        || err.contains("Failed to read from bridge")
        || err.contains("did not respond within")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transport_error_matches_transport_tag() {
        assert!(is_transport_error("Bridge process exited unexpectedly (transport)"));
    }

    #[test]
    fn transport_error_matches_write_failure() {
        assert!(is_transport_error("Failed to write to bridge: broken pipe"));
    }

    #[test]
    fn transport_error_matches_flush_failure() {
        assert!(is_transport_error("Failed to flush bridge stdin: broken pipe"));
    }

    #[test]
    fn transport_error_matches_read_failure() {
        assert!(is_transport_error("Failed to read from bridge: eof"));
    }

    #[test]
    fn transport_error_matches_timeout() {
        assert!(is_transport_error("Copilot bridge did not respond within 30 seconds"));
    }

    #[test]
    fn transport_error_rejects_normal_errors() {
        assert!(!is_transport_error("Authentication failed"));
        assert!(!is_transport_error("Invalid JSON"));
        assert!(!is_transport_error("Model not found"));
    }
}
