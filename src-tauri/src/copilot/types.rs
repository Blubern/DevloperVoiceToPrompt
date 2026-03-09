use serde::{Deserialize, Serialize};

/// Authentication status returned from the Copilot bridge.
#[derive(Serialize)]
pub struct CopilotAuthStatus {
    pub authenticated: bool,
    pub login: Option<String>,
    pub host: Option<String>,
    pub status_message: Option<String>,
}

/// A model available through the Copilot API.
#[derive(Serialize, Deserialize, Clone)]
pub struct CopilotModel {
    pub id: String,
    pub name: String,
    pub is_premium: bool,
    pub multiplier: f64,
}

/// A parsed JSON-RPC response from the bridge process.
#[derive(Deserialize)]
pub(crate) struct BridgeResponse {
    #[allow(dead_code)]
    pub id: u64,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}
