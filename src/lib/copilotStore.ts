import { tauriInvoke } from "./tauriInvoke";

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
  return tauriInvoke<void>("copilot_init");
}

export async function copilotAuthStatus(): Promise<CopilotAuthStatus> {
  return tauriInvoke<CopilotAuthStatus>("copilot_auth_status");
}

export async function copilotListModels(): Promise<CopilotModel[]> {
  return tauriInvoke<CopilotModel[]>("copilot_list_models");
}

export async function copilotStop(): Promise<void> {
  return tauriInvoke<void>("copilot_stop");
}

export async function copilotRestart(): Promise<void> {
  return tauriInvoke<void>("copilot_restart");
}

export async function copilotIsConnected(): Promise<boolean> {
  return tauriInvoke<boolean>("copilot_is_connected");
}

export async function copilotDisconnect(): Promise<void> {
  return tauriInvoke<void>("copilot_disconnect");
}

export async function copilotEnhance(
  modelId: string,
  systemPrompt: string,
  userText: string,
  deleteSession: boolean = true
): Promise<string> {
  return tauriInvoke<string>("copilot_enhance", {
    modelId,
    systemPrompt,
    userText,
    deleteSession,
  });
}
