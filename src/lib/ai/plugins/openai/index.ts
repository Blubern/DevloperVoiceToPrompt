// ---------------------------------------------------------------------------
// OpenAI AI plugin descriptor
// ---------------------------------------------------------------------------

import type { AIProviderPlugin } from "../../registry";
import type { AIProvider } from "../../types";
import { AI_PROVIDER_OPENAI } from "../../../constants";
import { OpenAIProvider } from "./OpenAIProvider";
import OpenAISettingsTab from "./OpenAISettingsTab.svelte";

const openaiPlugin: AIProviderPlugin = {
  id: AI_PROVIDER_OPENAI,
  label: "OpenAI",
  description: "OpenAI-compatible API (GPT-4o, GPT-4, etc.)",

  capabilities: new Set(["streaming"]),

  defaultConfig(): Record<string, unknown> {
    return {
      api_key: "",
      base_url: "",
      selected_model: "",
    };
  },

  canStart(config: Record<string, unknown>): { ready: boolean; error?: string } {
    const url = config.base_url as string;
    if (!url) {
      return { ready: false, error: "Base URL is required" };
    }
    const key = config.api_key as string;
    if (!key) {
      return { ready: false, error: "API key is required" };
    }
    return { ready: true };
  },

  createProvider(config: Record<string, unknown>): AIProvider {
    return new OpenAIProvider(config);
  },

  SettingsComponent: OpenAISettingsTab as any,
};

export default openaiPlugin;
