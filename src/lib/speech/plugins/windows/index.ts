// ---------------------------------------------------------------------------
// Windows Speech plugin descriptor — Windows native speech recognition
// ---------------------------------------------------------------------------

import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import type { SpeechProvider } from "../../types";
import { NativeProviderProxy } from "../../NativeProviderProxy";
import { invoke } from "@tauri-apps/api/core";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import WindowsSettingsTab from "./WindowsSettingsTab.svelte";

export interface WindowsProviderConfig {
  language: string;
}

const windowsPlugin: SpeechProviderPlugin = {
  id: "windows",
  label: "Windows Speech",
  description: "Windows native speech recognition (UWP SpeechRecognizer)",

  executionContext: "native",
  capabilities: new Set(["auto-punctuation"]),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig(): Record<string, unknown> {
    return {
      language: "en-US",
    } satisfies WindowsProviderConfig;
  },

  canStart(_config: Record<string, unknown>): { ready: boolean; error?: string } {
    return { ready: true };
  },

  async canStartAsync(_config: Record<string, unknown>): Promise<{ ready: boolean; error?: string }> {
    try {
      const available = await invoke<boolean>("native_speech_available", {
        providerId: "windows",
      });
      if (!available) {
        return {
          ready: false,
          error:
            "Windows Speech Recognition is not available. Check Settings → Privacy → Speech, inking, & typing.",
        };
      }
      return { ready: true };
    } catch {
      return { ready: true };
    }
  },

  createProvider(config: Record<string, unknown>, shared: SharedConfig): SpeechProvider {
    return new NativeProviderProxy("windows", {
      ...config,
      microphone: shared.microphone_device_id,
    });
  },

  SettingsComponent: WindowsSettingsTab as any,
};

export default windowsPlugin;
