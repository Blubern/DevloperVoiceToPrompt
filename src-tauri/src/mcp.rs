use std::sync::Arc;
use rmcp::{
    ErrorData, ServerHandler,
    handler::server::{tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolResult, Content, Implementation,
        ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_handler, tool_router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch};

// ---------------------------------------------------------------------------
// Shared state: one pending request at a time
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct PendingRequest {
    pub tx: oneshot::Sender<Result<String, String>>,
}

#[derive(Debug, Default, Clone)]
// tokio::sync::Mutex is used here (not std::sync::Mutex) so that
// .lock().await inside the async `voice_to_text` handler does not block
// the async runtime.  See also: mcp_submit_result / mcp_cancel in
// commands/mcp_cmd.rs, which must be async for the same reason.
pub struct McpState(pub Arc<tokio::sync::Mutex<Option<PendingRequest>>>);

// ---------------------------------------------------------------------------
// Server lifecycle handle: holds a shutdown signal for the running server
// ---------------------------------------------------------------------------

#[derive(Default, Clone)]
// McpServerHandle is only accessed from synchronous Tauri commands
// (is_mcp_running, start/stop), so std::sync::Mutex is appropriate here.
pub struct McpServerHandle(pub Arc<std::sync::Mutex<Option<watch::Sender<bool>>>>);

// ---------------------------------------------------------------------------
// Tauri event payload emitted to the popup
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpVoiceRequestPayload {
    pub input_reason: String,
    pub context_input: Option<String>,
}

// ---------------------------------------------------------------------------
// Tool input schema
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VoiceToTextInput {
    /// Why the voice input is being requested. Shown as a context banner in the
    /// dictation popup (e.g. "Write a commit message for the staged changes").
    pub input_reason: String,

    /// Optional pre-filled text to load into the dictation textarea. The user
    /// can edit or replace it by voice or keyboard before submitting.
    pub context_input: Option<String>,
}

// ---------------------------------------------------------------------------
// MCP server handler
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct VoiceToTextServer {
    app: AppHandle,
    state: McpState,
    tool_router: ToolRouter<Self>,
    timeout_seconds: u32,
}

impl VoiceToTextServer {
    fn new(app: AppHandle, state: McpState) -> Self {
        let timeout_seconds = crate::settings::load_settings(&app).mcp_timeout_seconds;
        Self { app, state, tool_router: Self::tool_router(), timeout_seconds }
    }
}

#[tool_router]
impl VoiceToTextServer {
    /// Open the voice dictation popup. The user speaks (or types), then clicks
    /// "Submit to MCP". Returns the final transcribed/edited text.
    #[tool(description = "Open the voice dictation popup. The user speaks or edits the text, then submits. Returns the final text.")]
    async fn voice_to_text(
        &self,
        Parameters(input): Parameters<VoiceToTextInput>,
    ) -> Result<CallToolResult, ErrorData> {
        tracing::info!("MCP tool 'voice_to_text' invoked (input_reason={})", input.input_reason);

        // Create the oneshot channel
        let (tx, rx) = oneshot::channel::<Result<String, String>>();

        // Reject concurrent requests and store the sender in a single critical section.
        {
            let mut guard = self.state.0.lock().await;
            if guard.is_some() {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Another dictation is already in progress. Please wait for it to complete.",
                )]));
            }
            *guard = Some(PendingRequest { tx });
        }

        // Emit event to the popup window with the context data
        let payload = McpVoiceRequestPayload {
            input_reason: input.input_reason.clone(),
            context_input: input.context_input.clone(),
        };

        if let Err(e) = self.app.emit("mcp-voice-request", &payload) {
            // Remove pending request on emit failure
            *self.state.0.lock().await = None;
            return Ok(CallToolResult::error(vec![Content::text(format!("Failed to open popup: {e}"))]));
        }

        // Show the popup window
        crate::create_or_show_popup(&self.app);

        // Wait for the user to submit or cancel. A timeout of 0 disables the limit.
        let timeout_seconds = self.timeout_seconds;

        let result = if timeout_seconds == 0 {
            match rx.await {
                Ok(Ok(text)) => Ok(CallToolResult::success(vec![Content::text(text)])),
                Ok(Err(reason)) => Ok(CallToolResult::error(vec![Content::text(format!("Dictation cancelled: {reason}"))])),
                Err(_) => Ok(CallToolResult::error(vec![Content::text("Dictation was cancelled (popup closed).")])),
            }
        } else {
            match tokio::time::timeout(std::time::Duration::from_secs(timeout_seconds as u64), rx).await {
                Ok(Ok(Ok(text))) => Ok(CallToolResult::success(vec![Content::text(text)])),
                Ok(Ok(Err(reason))) => Ok(CallToolResult::error(vec![Content::text(format!("Dictation cancelled: {reason}"))])),
                Ok(Err(_)) => Ok(CallToolResult::error(vec![Content::text("Dictation was cancelled (popup closed).")])),
                Err(_) => Ok(CallToolResult::error(vec![Content::text(format!(
                    "Dictation timed out after {timeout_seconds} seconds with no submission.",
                ))])),
            }
        };

        // Defensive cleanup: ensure the pending request slot is always cleared when
        // this tool call exits, regardless of whether mcp_submit_result / mcp_cancel
        // was invoked by the frontend.  Those commands already call guard.take(), so
        // this assignment is a no-op on the normal path — it only matters when the
        // receiver is dropped before a value is sent (unexpected runtime edge-case).
        *self.state.0.lock().await = None;

        result
    }
}

#[tool_handler]
impl ServerHandler for VoiceToTextServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "DeveloperVoiceToText",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Use the voice_to_text tool to capture voice input from the user. \
                 Provide an input_reason so the user understands why you need their input. \
                 Optionally supply context_input to pre-fill the text for them to edit.",
            )
    }
}

// ---------------------------------------------------------------------------
// Server startup / shutdown
// ---------------------------------------------------------------------------

pub fn stop_mcp_server(handle: &McpServerHandle) {
    if let Ok(mut guard) = handle.0.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(true);
            tracing::info!("MCP server shutdown signal sent");
        }
    } else {
        tracing::error!("MCP server handle lock poisoned during shutdown");
    }
}

pub fn start_mcp_server(app: AppHandle, port: u16) {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService,
        session::local::LocalSessionManager,
    };

    let server_handle = app.state::<McpServerHandle>();

    // Stop any existing server first
    stop_mcp_server(&server_handle);

    // Create shutdown channel
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    if let Ok(mut guard) = server_handle.0.lock() {
        *guard = Some(shutdown_tx);
    } else {
        tracing::error!("MCP server handle lock poisoned; cannot start server");
        return;
    }

    tauri::async_runtime::spawn(async move {
        let addr = format!("127.0.0.1:{port}");
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => {
                tracing::info!("MCP server listening on http://{addr}/mcp (service=DeveloperVoiceToText, tools=[voice_to_text])");
                l
            }
            Err(e) => {
                tracing::error!("Failed to bind MCP server on {addr}: {e}");
                return;
            }
        };

        let state = app.state::<McpState>().inner().clone();
        let app_clone = app.clone();

        let service: StreamableHttpService<VoiceToTextServer, LocalSessionManager> =
            StreamableHttpService::new(
                move || Ok(VoiceToTextServer::new(app_clone.clone(), state.clone())),
                Default::default(),
                StreamableHttpServerConfig::default(),
            );

        let router = axum::Router::new().nest_service("/mcp", service);

        let shutdown_signal = async move {
            let _ = shutdown_rx.wait_for(|&v| v).await;
        };

        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown_signal)
            .await
        {
            tracing::error!("MCP server stopped: {e}");
        } else {
            tracing::info!("MCP server shut down gracefully");
        }
    });
}
