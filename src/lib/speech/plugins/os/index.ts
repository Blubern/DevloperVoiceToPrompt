// ---------------------------------------------------------------------------
// OS (Web Speech API) plugin descriptor
// ---------------------------------------------------------------------------

import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import type { SpeechProvider } from "../../types";
import { OsSpeechProvider } from "./OsSpeechProvider";
import { webSpeechAvailable } from "../../speechHelpers";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import OsSettingsTab from "./OsSettingsTab.svelte";

export interface OsProviderConfig {
  language: string;
  auto_restart: boolean;
  max_restarts: number;
}

const osPlugin: SpeechProviderPlugin = {
  id: "os",
  label: "Web Speech",
  description: "Built-in browser speech recognition (Web Speech API)",

  executionContext: "browser",
  capabilities: new Set(),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig(): Record<string, unknown> {
    return {
      language: "en-US",
      auto_restart: true,
      max_restarts: 3,
    } satisfies OsProviderConfig;
  },

  canStart(_config: Record<string, unknown>): { ready: boolean; error?: string } {
    if (!webSpeechAvailable) {
      return { ready: false, error: "Web Speech API is not available in this browser." };
    }
    return { ready: true };
  },

  createProvider(config: Record<string, unknown>, _shared: SharedConfig): SpeechProvider {
    const c = config as unknown as OsProviderConfig;
    return new OsSpeechProvider(
      c.language ?? "en-US",
      c.auto_restart ?? true,
      c.max_restarts ?? 3,
    );
  },

  // Placeholder — will be replaced with actual Svelte component in Phase 3
  SettingsComponent: OsSettingsTab as any,
};

export default osPlugin;
