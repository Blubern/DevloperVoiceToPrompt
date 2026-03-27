import { tauriInvoke } from "./tauriInvoke";

export interface AiModel {
  id: string;
  name: string;
}

export async function openaiComplete(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userText: string,
): Promise<string> {
  return tauriInvoke<string>("openai_complete", {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    userText,
  });
}

export async function openaiListModels(
  baseUrl: string,
  apiKey: string,
): Promise<AiModel[]> {
  return tauriInvoke<AiModel[]>("openai_list_models", { baseUrl, apiKey });
}

export async function openaiCheckConnection(
  baseUrl: string,
  apiKey: string,
): Promise<boolean> {
  return tauriInvoke<boolean>("openai_check_connection", { baseUrl, apiKey });
}
