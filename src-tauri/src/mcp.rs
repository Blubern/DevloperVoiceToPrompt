use std::sync::{Arc, Mutex};
use rmcp::{
    ErrorData, ServerHandler,
    handler::server::{tool::ToolRouter, wrapper::Parameters},
    model::{
        CallToolResult, Content, Implementation,
        ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_router,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

// ---------------------------------------------------------------------------
// Shared state: one pending request at a time
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct PendingRequest {
    pub tx: oneshot::Sender<Result<String, String>>,
}

#[derive(Debug, Default, Clone)]
pub struct McpState(pub Arc<Mutex<Option<PendingRequest>>>);

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
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

impl VoiceToTextServer {
    fn new(app: AppHandle, state: McpState) -> Self {
        Self { app, state, tool_router: Self::tool_router() }
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
        // Reject concurrent requests
        {
            let guard = self.state.0.lock().unwrap();
            if guard.is_some() {
                return Ok(CallToolResult::error(vec![Content::text(
                    "Another dictation is already in progress. Please wait for it to complete.",
                )]));
            }
        }

        // Create the oneshot channel
        let (tx, rx) = oneshot::channel::<Result<String, String>>();

        // Store the sender so the Tauri command can resolve it
        {
            let mut guard = self.state.0.lock().unwrap();
            *guard = Some(PendingRequest { tx });
        }

        // Emit event to the popup window with the context data
        let payload = McpVoiceRequestPayload {
            input_reason: input.input_reason.clone(),
            context_input: input.context_input.clone(),
        };

        if let Err(e) = self.app.emit("mcp-voice-request", &payload) {
            // Remove pending request on emit failure
            let mut guard = self.state.0.lock().unwrap();
            *guard = None;
            return Ok(CallToolResult::error(vec![Content::text(format!("Failed to open popup: {e}"))]));
        }

        // Show the popup window
        crate::create_or_show_popup(&self.app);

        // Wait for the user to submit or cancel (up to 5 minutes)
        match tokio::time::timeout(std::time::Duration::from_secs(300), rx).await {
            Ok(Ok(Ok(text))) => Ok(CallToolResult::success(vec![Content::text(text)])),
            Ok(Ok(Err(reason))) => Ok(CallToolResult::error(vec![Content::text(format!("Dictation cancelled: {reason}"))])),
            Ok(Err(_)) => Ok(CallToolResult::error(vec![Content::text("Dictation was cancelled (popup closed).")] )),
            Err(_) => {
                // Timeout — clean up state
                let mut guard = self.state.0.lock().unwrap();
                *guard = None;
                Ok(CallToolResult::error(vec![Content::text(
                    "Dictation timed out after 5 minutes with no submission.",
                )]))
            }
        }
    }
}

impl ServerHandler for VoiceToTextServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "developer-voice-to-prompt",
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
// Server startup
// ---------------------------------------------------------------------------

pub fn start_mcp_server(app: AppHandle, port: u16) {
    use rmcp::transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService,
        session::local::LocalSessionManager,
    };

    tauri::async_runtime::spawn(async move {
        let addr = format!("127.0.0.1:{port}");
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => {
                tracing::info!("MCP server listening on http://{addr}/mcp");
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
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!("MCP server stopped: {e}");
        }
    });
}
