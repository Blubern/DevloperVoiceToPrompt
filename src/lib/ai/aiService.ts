// ---------------------------------------------------------------------------
// aiService.ts — Barrel re-export + registry-based factory.
// AI provider implementations live in src/lib/ai/plugins/*
// ---------------------------------------------------------------------------

import type { AppSettings } from "../settingsStore";
import type { AIProvider } from "./types";

// Import plugins/index to ensure all built-in plugins are registered
import { aiProviderRegistry } from "./plugins/index";

// Re-export types
export type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamCallbacks,
  AIProviderCapability,
  AIProviderIndicator,
} from "./types";

// Re-export registry
export { aiProviderRegistry } from "./plugins/index";
export type { AIProviderPlugin, AISettingsTabProps } from "./registry";

// ---------------------------------------------------------------------------
// Factory — uses registry to create providers from settings
// ---------------------------------------------------------------------------

/**
 * Build the per-provider config from the ai_provider_configs map.
 * Falls back to the plugin's defaultConfig() if no config exists.
 */
function buildProviderConfig(settings: AppSettings): Record<string, unknown> {
  const plugin = aiProviderRegistry.get(settings.ai_provider);
  if (!plugin) return {};

  return settings.ai_provider_configs?.[settings.ai_provider]
    ?? plugin.defaultConfig();
}

/**
 * Create an AI provider instance from the current settings.
 * Looks up the active provider in the registry and creates it
 * with the stored per-provider config.
 */
export function createAIProvider(settings: AppSettings): AIProvider {
  const plugin = aiProviderRegistry.get(settings.ai_provider);
  if (!plugin) {
    // Fall back to first registered provider
    const fallback = aiProviderRegistry.getAll()[0];
    if (!fallback) {
      throw new Error("No AI providers registered");
    }
    return fallback.createProvider(fallback.defaultConfig());
  }

  return plugin.createProvider(buildProviderConfig(settings));
}
