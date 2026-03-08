use tauri::{Manager, State};
use crate::mcp::{McpState, McpServerHandle};

/// Called by the frontend when the user clicks "Submit to MCP".
/// Resolves the pending MCP tool call with the dictated text.
#[tauri::command]
pub fn mcp_submit_result(text: String, state: State<McpState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(pending) = guard.take() {
        if pending.tx.send(Ok(text)).is_err() {
            tracing::warn!("MCP submit: receiver already dropped");
        }
        Ok(())
    } else {
        Err("No pending MCP dictation request".into())
    }
}

/// Called by the frontend when the popup is closed/dismissed without submitting.
/// Cancels the pending MCP tool call so the caller receives an error instead of hanging.
#[tauri::command]
pub fn mcp_cancel(state: State<McpState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(pending) = guard.take() {
        if pending.tx.send(Err("cancelled".into())).is_err() {
            tracing::warn!("MCP cancel: receiver already dropped");
        }
    }
    Ok(())
}

/// Check whether the MCP server is currently running (has an active shutdown handle).
#[tauri::command]
pub fn is_mcp_running(app: tauri::AppHandle) -> bool {
    let handle = app.state::<McpServerHandle>();
    let guard = match handle.0.lock() {
        Ok(g) => g,
        Err(e) => {
            tracing::error!("MCP server handle lock poisoned: {e}");
            return false;
        }
    };
    guard.is_some()
}
