// ---------------------------------------------------------------------------
// Shared HTTP helpers for OpenAI-compatible AI providers
// ---------------------------------------------------------------------------

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Model descriptor returned by list-models endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModel {
    pub id: String,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ChatCompletionRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

/// Send a chat completion request to an OpenAI-compatible endpoint.
pub async fn chat_complete(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_text: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    if model.is_empty() {
        return Err("Model must not be empty".into());
    }
    if system_prompt.len() > 10_000 {
        return Err("system_prompt exceeds 10 000 character limit".into());
    }
    if user_text.len() > 10_000 {
        return Err("user_text exceeds 10 000 character limit".into());
    }

    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let body = ChatCompletionRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system",
                content: system_prompt,
            },
            ChatMessage {
                role: "user",
                content: user_text,
            },
        ],
    };

    let mut req = client.post(&url).json(&body);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .unwrap_or_else(|_| "(no body)".to_string());
        return Err(format!("API returned {status}: {body_text}"));
    }

    let parsed: ChatCompletionResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "No choices in API response".into())
}

// ---------------------------------------------------------------------------
// List models — OpenAI format (GET /v1/models)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OpenAIModelsResponse {
    data: Vec<OpenAIModelEntry>,
}

#[derive(Deserialize)]
struct OpenAIModelEntry {
    id: String,
}

/// List models from an OpenAI-compatible `/v1/models` endpoint.
pub async fn list_models_openai(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<AiModel>, String> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .unwrap_or_else(|_| "(no body)".to_string());
        return Err(format!("API returned {status}: {body_text}"));
    }

    let parsed: OpenAIModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse models response: {e}"))?;

    Ok(parsed
        .data
        .into_iter()
        .map(|m| AiModel {
            name: m.id.clone(),
            id: m.id,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// List models — Ollama format (GET /api/tags)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelEntry>,
}

#[derive(Deserialize)]
struct OllamaModelEntry {
    name: String,
}

/// List models from an Ollama `/api/tags` endpoint.
pub async fn list_models_ollama(base_url: &str) -> Result<Vec<AiModel>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .unwrap_or_else(|_| "(no body)".to_string());
        return Err(format!("API returned {status}: {body_text}"));
    }

    let parsed: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama tags response: {e}"))?;

    Ok(parsed
        .models
        .into_iter()
        .map(|m| AiModel {
            id: m.name.clone(),
            name: m.name,
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Connection check — try to reach the API
// ---------------------------------------------------------------------------

/// Quick connectivity check. For OpenAI-compatible APIs, hits `/v1/models`.
/// For Ollama, hits `/api/tags`. Determined by whether an API key is provided.
pub async fn check_connection(
    base_url: &str,
    api_key: Option<&str>,
    ollama_style: bool,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let url = if ollama_style {
        format!("{}/api/tags", base_url.trim_end_matches('/'))
    } else {
        format!("{}/v1/models", base_url.trim_end_matches('/'))
    };

    let mut req = client.get(&url);
    if let Some(key) = api_key {
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    if resp.status().is_success() {
        Ok(true)
    } else {
        let status = resp.status();
        Err(format!("Server returned {status}"))
    }
}
