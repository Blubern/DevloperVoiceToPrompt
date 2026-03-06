import { invoke } from "@tauri-apps/api/core";

export interface CopilotAuthStatus {
  authenticated: boolean;
  login: string | null;
  host: string | null;
  status_message: string | null;
}

export interface CopilotModel {
  id: string;
  name: string;
  is_premium: boolean;
  multiplier: number;
}

export async function copilotInit(): Promise<void> {
  return invoke<void>("copilot_init");
}

export async function copilotAuthStatus(): Promise<CopilotAuthStatus> {
  return invoke<CopilotAuthStatus>("copilot_auth_status");
}

export async function copilotListModels(): Promise<CopilotModel[]> {
  return invoke<CopilotModel[]>("copilot_list_models");
}

export async function copilotStop(): Promise<void> {
  return invoke<void>("copilot_stop");
}

export async function copilotEnhance(
  modelId: string,
  systemPrompt: string,
  userText: string,
  deleteSession: boolean = true
): Promise<string> {
  return invoke<string>("copilot_enhance", {
    modelId,
    systemPrompt,
    userText,
    deleteSession,
  });
}
