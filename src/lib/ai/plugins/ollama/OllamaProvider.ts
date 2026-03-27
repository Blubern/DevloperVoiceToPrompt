// ---------------------------------------------------------------------------
// OllamaProvider — wraps ollamaStore.ts for the AI plugin system
// ---------------------------------------------------------------------------

import type { AIProvider, AICompletionRequest, AICompletionResponse, AIProviderIndicator } from "../../types";
import { ollamaComplete } from "../../../ollamaStore";

// Ollama icon — theme-aware variants
const OLLAMA_ICON_DARK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#cdd6f4"/><path d="M14 28v-6c0-4 2.5-7 6-9 3.5 2 6 5 6 9v6" fill="none" stroke="#1e1e2e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.5" cy="17" r="1.3" fill="#1e1e2e"/><circle cx="22.5" cy="17" r="1.3" fill="#1e1e2e"/><path d="M13 15c-1-3 0-6 2-8" fill="none" stroke="#1e1e2e" stroke-width="1.5" stroke-linecap="round"/><path d="M27 15c1-3 0-6-2-8" fill="none" stroke="#1e1e2e" stroke-width="1.5" stroke-linecap="round"/></svg>')}`;
const OLLAMA_ICON_LIGHT = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#4c4f69"/><path d="M14 28v-6c0-4 2.5-7 6-9 3.5 2 6 5 6 9v6" fill="none" stroke="#eff1f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17.5" cy="17" r="1.3" fill="#eff1f5"/><circle cx="22.5" cy="17" r="1.3" fill="#eff1f5"/><path d="M13 15c-1-3 0-6 2-8" fill="none" stroke="#eff1f5" stroke-width="1.5" stroke-linecap="round"/><path d="M27 15c1-3 0-6-2-8" fill="none" stroke="#eff1f5" stroke-width="1.5" stroke-linecap="round"/></svg>')}`;

export class OllamaProvider implements AIProvider {
  private serverUrl: string;
  private model: string;

  constructor(config: Record<string, unknown>) {
    this.serverUrl = (config.server_url as string) ?? "";
    this.model = (config.selected_model as string) ?? "";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = request.model ?? this.model;
    if (!model) {
      throw new Error("No model selected for Ollama enhancement");
    }
    const text = await ollamaComplete(
      this.serverUrl,
      model,
      request.systemPrompt,
      request.userText,
    );
    return { text };
  }

  isReady(): boolean {
    return !!this.model;
  }

  async getIndicator(): Promise<AIProviderIndicator | null> {
    if (this.model) {
      return { label: "Ollama", imageUrlDark: OLLAMA_ICON_DARK, imageUrlLight: OLLAMA_ICON_LIGHT };
    }
    return null;
  }

  dispose(): void {
    // No-op — stateless HTTP calls
  }
}
