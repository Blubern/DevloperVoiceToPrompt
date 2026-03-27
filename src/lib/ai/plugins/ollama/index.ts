// ---------------------------------------------------------------------------
// Ollama AI plugin descriptor
// ---------------------------------------------------------------------------

import type { AIProviderPlugin } from "../../registry";
import type { AIProvider } from "../../types";
import { AI_PROVIDER_OLLAMA } from "../../../constants";
import { OllamaProvider } from "./OllamaProvider";
import OllamaSettingsTab from "./OllamaSettingsTab.svelte";

const ollamaPlugin: AIProviderPlugin = {
  id: AI_PROVIDER_OLLAMA,
  label: "Ollama",
  description: "Local AI models via Ollama server",

  capabilities: new Set(["local-model"]),

  defaultConfig(): Record<string, unknown> {
    return {
      server_url: "",
      selected_model: "",
    };
  },

  canStart(config: Record<string, unknown>): { ready: boolean; error?: string } {
    const url = config.server_url as string;
    if (!url) {
      return { ready: false, error: "Server URL is required" };
    }
    return { ready: true };
  },

  createProvider(config: Record<string, unknown>): AIProvider {
    return new OllamaProvider(config);
  },

  SettingsComponent: OllamaSettingsTab as any,
};

export default ollamaPlugin;
