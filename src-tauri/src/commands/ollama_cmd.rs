use crate::ai_http::{self, AiModel};

#[tauri::command]
pub async fn ollama_complete(
    base_url: String,
    model: String,
    system_prompt: String,
    user_text: String,
) -> Result<String, String> {
    ai_http::chat_complete(&base_url, None, &model, &system_prompt, &user_text, 120).await
}

#[tauri::command]
pub async fn ollama_list_models(base_url: String) -> Result<Vec<AiModel>, String> {
    ai_http::list_models_ollama(&base_url).await
}

#[tauri::command]
pub async fn ollama_check_connection(base_url: String) -> Result<bool, String> {
    ai_http::check_connection(&base_url, None, true).await
}
