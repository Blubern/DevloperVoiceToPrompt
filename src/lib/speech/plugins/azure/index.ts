// ---------------------------------------------------------------------------
// Azure Speech plugin descriptor
// ---------------------------------------------------------------------------

import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import type { SpeechProvider } from "../../types";
import { AzureSpeechProvider } from "./AzureSpeechProvider";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import AzureSettingsTab from "./AzureSettingsTab.svelte";

export interface AzureProviderConfig {
  speech_key: string;
  region: string;
  languages: string[];
  auto_punctuation: boolean;
}

const azurePlugin: SpeechProviderPlugin = {
  id: "azure",
  label: "Azure",
  description: "Azure Cognitive Services Speech-to-Text",

  executionContext: "browser",
  capabilities: new Set(["multi-language", "phrase-list", "auto-punctuation"]),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "multi",
  languageConfigKey: "languages",

  defaultConfig(): Record<string, unknown> {
    return {
      speech_key: "",
      region: "eastus",
      languages: ["en-US"],
      auto_punctuation: true,
    } satisfies AzureProviderConfig;
  },

  canStart(config: Record<string, unknown>): { ready: boolean; error?: string } {
    const c = config as unknown as AzureProviderConfig;
    if (!c.speech_key || !c.region) {
      return { ready: false, error: "Azure Speech key not configured. Go to Settings → Speech." };
    }
    return { ready: true };
  },

  createProvider(config: Record<string, unknown>, shared: SharedConfig): SpeechProvider {
    const c = config as unknown as AzureProviderConfig;
    return new AzureSpeechProvider(
      c.speech_key ?? "",
      c.region ?? "eastus",
      c.languages?.length ? c.languages : ["en-US"],
      shared.silence_timeout_seconds,
      shared.microphone_device_id || undefined,
      shared.phrase_list.length > 0 ? shared.phrase_list : undefined,
      c.auto_punctuation,
    );
  },

  // Placeholder — will be replaced with actual Svelte component in Phase 3
  SettingsComponent: AzureSettingsTab as any,
};

export default azurePlugin;
