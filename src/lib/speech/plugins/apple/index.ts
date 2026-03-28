// ---------------------------------------------------------------------------
// Apple Speech plugin descriptor — macOS native speech recognition
// ---------------------------------------------------------------------------

import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import type { SpeechProvider } from "../../types";
import { NativeProviderProxy } from "../../NativeProviderProxy";
import { invoke } from "@tauri-apps/api/core";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import AppleSettingsTab from "./AppleSettingsTab.svelte";

export interface AppleProviderConfig {
  language: string;
  on_device: boolean;
}

const applePlugin: SpeechProviderPlugin = {
  id: "apple",
  label: "Apple Speech",
  description: "macOS native speech recognition (SFSpeechRecognizer)",

  executionContext: "native",
  capabilities: new Set(["auto-punctuation"]),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig(): Record<string, unknown> {
    return {
      language: "en-US",
      on_device: false,
    } satisfies AppleProviderConfig;
  },

  canStart(_config: Record<string, unknown>): { ready: boolean; error?: string } {
    return { ready: true };
  },

  async canStartAsync(_config: Record<string, unknown>): Promise<{ ready: boolean; error?: string }> {
    try {
      const available = await invoke<boolean>("native_speech_available", {
        providerId: "apple",
      });
      if (!available) {
        return {
          ready: false,
          error:
            "Apple Speech Recognition is not available. Grant permission in System Settings → Privacy & Security → Speech Recognition.",
        };
      }
      return { ready: true };
    } catch {
      return { ready: true };
    }
  },

  createProvider(config: Record<string, unknown>, shared: SharedConfig): SpeechProvider {
    return new NativeProviderProxy("apple", {
      ...config,
      microphone: shared.microphone_device_id,
    });
  },

  SettingsComponent: AppleSettingsTab as any,
};

export default applePlugin;
