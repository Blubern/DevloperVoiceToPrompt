// ---------------------------------------------------------------------------
// OpenAIProvider — wraps openaiStore.ts for the AI plugin system
// ---------------------------------------------------------------------------

import type { AIProvider, AICompletionRequest, AICompletionResponse, AIProviderIndicator } from "../../types";
import { openaiComplete } from "../../../openaiStore";

// OpenAI icon — theme-aware variants
const OPENAI_ICON_DARK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#10a37f"/><path d="M20 8a1.2 1.2 0 0 1 1.04.6l7.5 13a1.2 1.2 0 0 1 0 1.2l-7.5 13a1.2 1.2 0 0 1-2.08 0l-7.5-13a1.2 1.2 0 0 1 0-1.2l7.5-13A1.2 1.2 0 0 1 20 8Z" fill="none" stroke="white" stroke-width="1.5"/><circle cx="20" cy="20.4" r="3" fill="white"/></svg>')}`;
const OPENAI_ICON_LIGHT = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#0d8c6d"/><path d="M20 8a1.2 1.2 0 0 1 1.04.6l7.5 13a1.2 1.2 0 0 1 0 1.2l-7.5 13a1.2 1.2 0 0 1-2.08 0l-7.5-13a1.2 1.2 0 0 1 0-1.2l7.5-13A1.2 1.2 0 0 1 20 8Z" fill="none" stroke="white" stroke-width="1.5"/><circle cx="20" cy="20.4" r="3" fill="white"/></svg>')}`;

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: Record<string, unknown>) {
    this.apiKey = (config.api_key as string) ?? "";
    this.baseUrl = (config.base_url as string) ?? "";
    this.model = (config.selected_model as string) ?? "";
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const model = request.model ?? this.model;
    if (!model) {
      throw new Error("No model selected for OpenAI enhancement");
    }
    const text = await openaiComplete(
      this.baseUrl,
      this.apiKey,
      model,
      request.systemPrompt,
      request.userText,
    );
    return { text };
  }

  isReady(): boolean {
    return !!this.apiKey && !!this.baseUrl;
  }

  async getIndicator(): Promise<AIProviderIndicator | null> {
    if (this.apiKey && this.baseUrl) {
      return { label: "OpenAI", imageUrlDark: OPENAI_ICON_DARK, imageUrlLight: OPENAI_ICON_LIGHT };
    }
    return null;
  }

  dispose(): void {
    // No-op — stateless HTTP calls
  }
}
