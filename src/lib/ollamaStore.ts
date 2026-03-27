import { tauriInvoke } from "./tauriInvoke";
import type { AiModel } from "./openaiStore";

export type { AiModel };

export async function ollamaComplete(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userText: string,
): Promise<string> {
  return tauriInvoke<string>("ollama_complete", {
    baseUrl,
    model,
    systemPrompt,
    userText,
  });
}

export async function ollamaListModels(
  baseUrl: string,
): Promise<AiModel[]> {
  return tauriInvoke<AiModel[]>("ollama_list_models", { baseUrl });
}

export async function ollamaCheckConnection(
  baseUrl: string,
): Promise<boolean> {
  return tauriInvoke<boolean>("ollama_check_connection", { baseUrl });
}
