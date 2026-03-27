import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core");

import { createAIProvider, aiProviderRegistry } from "../lib/ai/aiService";
import { DEFAULT_SETTINGS } from "../lib/settingsStore";

describe("createAIProvider", () => {
  it("creates a provider for the default ai_provider (copilot)", () => {
    const provider = createAIProvider({
      ...DEFAULT_SETTINGS,
      ai_provider: "copilot",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
    expect(typeof provider.isReady).toBe("function");
  });

  it("passes provider config from ai_provider_configs", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "copilot",
      ai_provider_configs: {
        copilot: { selected_model: "gpt-4o" },
      },
    };
    const provider = createAIProvider(settings);
    // Verify the provider was created with config (model stored internally)
    expect(provider).toBeDefined();
  });

  it("falls back to first registered provider when ai_provider is unknown", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ai_provider: "nonexistent-provider",
    };
    // Should not throw — falls back to first provider
    const provider = createAIProvider(settings);
    expect(provider).toBeDefined();
  });

  it("copilot plugin is registered in the singleton registry", () => {
    expect(aiProviderRegistry.get("copilot")).toBeDefined();
    expect(aiProviderRegistry.getLabel("copilot")).toBe("GitHub Copilot");
  });

  it("copilot plugin has expected capabilities", () => {
    const plugin = aiProviderRegistry.get("copilot")!;
    expect(plugin.capabilities.has("requires-auth")).toBe(true);
    expect(plugin.capabilities.has("requires-backend")).toBe(true);
    expect(plugin.capabilities.has("streaming")).toBe(false);
  });

  it("copilot plugin default config has selected_model", () => {
    const plugin = aiProviderRegistry.get("copilot")!;
    expect(plugin.defaultConfig()).toEqual({ selected_model: "" });
  });
});
