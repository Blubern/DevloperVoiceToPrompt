// ---------------------------------------------------------------------------
// Copilot AI plugin descriptor
// ---------------------------------------------------------------------------

import type { AIProviderPlugin } from "../../registry";
import type { AIProvider } from "../../types";
import { CopilotAIProvider } from "./CopilotAIProvider";
import CopilotSettingsTab from "./CopilotSettingsTab.svelte";

const copilotPlugin: AIProviderPlugin = {
  id: "copilot",
  label: "GitHub Copilot",
  description: "AI-powered prompt enhancement via GitHub Copilot SDK",

  capabilities: new Set(["requires-auth", "requires-backend"]),

  defaultConfig(): Record<string, unknown> {
    return {
      selected_model: "",
    };
  },

  canStart(config: Record<string, unknown>): { ready: boolean; error?: string } {
    // Copilot readiness is checked asynchronously via isReady()
    // This sync check just validates minimal config
    return { ready: true };
  },

  createProvider(config: Record<string, unknown>): AIProvider {
    return new CopilotAIProvider(config);
  },

  SettingsComponent: CopilotSettingsTab as any,
};

export default copilotPlugin;
