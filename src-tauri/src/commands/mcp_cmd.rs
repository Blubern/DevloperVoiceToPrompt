use tauri::State;
use crate::mcp::McpState;

/// Called by the frontend when the user clicks "Submit to MCP".
/// Resolves the pending MCP tool call with the dictated text.
#[tauri::command]
pub fn mcp_submit_result(text: String, state: State<McpState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(pending) = guard.take() {
        let _ = pending.tx.send(Ok(text));
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
        let _ = pending.tx.send(Err("cancelled".into()));
    }
    Ok(())
}
