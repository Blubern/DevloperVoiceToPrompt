// ---------------------------------------------------------------------------
// CopilotAIProvider — wraps copilotStore.ts for the AI plugin system
// ---------------------------------------------------------------------------

import type { AIProvider, AICompletionRequest, AICompletionResponse, AIProviderIndicator } from "../../types";
import { copilotAuthStatus, copilotEnhance } from "../../../copilotStore";

// GitHub Copilot icon — theme-aware variants
const COPILOT_ICON_DARK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#cdd6f4" /><path d="M12 22c0-4 3-8 8-8s8 4 8 8v2c0 1-1 2-2 2h-2v-4a4 4 0 0 0-8 0v4h-2c-1 0-2-1-2-2v-2Z" fill="none" stroke="#1e1e2e" stroke-width="1.8"/><circle cx="16.5" cy="22" r="1.5" fill="#1e1e2e"/><circle cx="23.5" cy="22" r="1.5" fill="#1e1e2e"/></svg>')}`;
const COPILOT_ICON_LIGHT = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#4c4f69" /><path d="M12 22c0-4 3-8 8-8s8 4 8 8v2c0 1-1 2-2 2h-2v-4a4 4 0 0 0-8 0v4h-2c-1 0-2-1-2-2v-2Z" fill="none" stroke="#eff1f5" stroke-width="1.8"/><circle cx="16.5" cy="22" r="1.5" fill="#eff1f5"/><circle cx="23.5" cy="22" r="1.5" fill="#eff1f5"/></svg>')}`;

export class CopilotAIProvider implements AIProvider {
  private model: string;

  constructor(config: Record<string, unknown>) {
    this.model = (config.selected_model as string) ?? "";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = request.model ?? this.model;
    if (!model) {
      throw new Error("No model selected for Copilot enhancement");
    }
    const text = await copilotEnhance(model, request.systemPrompt, request.userText);
    return { text };
  }

  async isReady(): Promise<boolean> {
    try {
      const status = await copilotAuthStatus();
      return status.authenticated;
    } catch {
      return false;
    }
  }

  async getIndicator(): Promise<AIProviderIndicator | null> {
    try {
      const status = await copilotAuthStatus();
      if (status.authenticated) {
        return {
          label: status.login ?? "Copilot",
          imageUrlDark: COPILOT_ICON_DARK,
          imageUrlLight: COPILOT_ICON_LIGHT,
        };
      }
    } catch {
      // Ignore — no indicator when auth check fails
    }
    return null;
  }

  dispose(): void {
    // No-op — per-call client, nothing to tear down
  }
}
