use crate::ai_http::{self, AiModel};

#[tauri::command]
pub async fn openai_complete(
    base_url: String,
    api_key: String,
    model: String,
    system_prompt: String,
    user_text: String,
) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("OpenAI API key is required".into());
    }
    ai_http::chat_complete(&base_url, Some(&api_key), &model, &system_prompt, &user_text, 60).await
}

#[tauri::command]
pub async fn openai_list_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<AiModel>, String> {
    if api_key.is_empty() {
        return Err("OpenAI API key is required".into());
    }
    ai_http::list_models_openai(&base_url, &api_key).await
}

#[tauri::command]
pub async fn openai_check_connection(
    base_url: String,
    api_key: String,
) -> Result<bool, String> {
    if api_key.is_empty() {
        return Err("OpenAI API key is required".into());
    }
    ai_http::check_connection(&base_url, Some(&api_key), false).await
}
