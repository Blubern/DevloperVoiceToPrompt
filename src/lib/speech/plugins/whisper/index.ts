// ---------------------------------------------------------------------------
// Whisper (local) plugin descriptor
// ---------------------------------------------------------------------------

import type { SpeechProviderPlugin, SharedConfig } from "../../registry";
import type { SpeechProvider } from "../../types";
import { WhisperSpeechProvider } from "./WhisperSpeechProvider";
import { SUPPORTED_LANGUAGES } from "../../../speechConstants";
import { invoke } from "@tauri-apps/api/core";
import WhisperSettingsTab from "./WhisperSettingsTab.svelte";

export interface WhisperProviderConfig {
  model: string;
  language: string;
  decode_interval: number;
  context_overlap: number;
  use_gpu: boolean;
  cli_version: string;
  cli_variant: string;
  chunk_seconds: number;
}

const whisperPlugin: SpeechProviderPlugin = {
  id: "whisper",
  label: "Whisper",
  description: "Local Whisper speech recognition via whisper.cpp server",

  executionContext: "hybrid",
  capabilities: new Set([
    "realtime-metrics",
    "audio-level",
    "phrase-list",
    "requires-backend",
    "local-model",
  ]),

  supportedLanguages: SUPPORTED_LANGUAGES,
  languageMode: "single",
  languageConfigKey: "language",

  defaultConfig(): Record<string, unknown> {
    return {
      model: "base",
      language: "en-US",
      decode_interval: 1,
      context_overlap: 1,
      use_gpu: false,
      cli_version: "1.8.3",
      cli_variant: "cpu",
      chunk_seconds: 3,
    } satisfies WhisperProviderConfig;
  },

  canStart(config: Record<string, unknown>): { ready: boolean; error?: string } {
    const c = config as unknown as WhisperProviderConfig;
    if (!c.model) {
      return { ready: false, error: "No Whisper model selected. Go to Settings → Speech → Whisper." };
    }
    return { ready: true };
  },

  async canStartAsync(config: Record<string, unknown>): Promise<{ ready: boolean; error?: string }> {
    const c = config as unknown as WhisperProviderConfig;
    if (!c.model) {
      return { ready: false, error: "No Whisper model selected. Go to Settings → Speech → Whisper." };
    }
    try {
      const models = await invoke<{ name: string; downloaded: boolean }[]>("whisper_list_models");
      const selected = models.find((m) => m.name === c.model);
      if (selected?.downloaded) {
        return { ready: true };
      }
      // Model not downloaded — try to find an alternative
      const available = models.find((m) => m.downloaded);
      if (available) {
        return { ready: false, error: `Selected model "${c.model}" is not downloaded. "${available.name}" is available — switch in Settings → Speech → Whisper.` };
      }
      return { ready: false, error: "Selected Whisper model not downloaded. Go to Settings → Speech → Whisper to download it." };
    } catch {
      // If the backend call fails, fall back to sync check
      return { ready: true };
    }
  },

  createProvider(config: Record<string, unknown>, shared: SharedConfig): SpeechProvider {
    const c = config as unknown as WhisperProviderConfig;
    return new WhisperSpeechProvider(
      c.model ?? "base",
      c.language ?? "en-US",
      c.decode_interval ?? 1,
      c.context_overlap ?? 1,
      c.use_gpu ?? false,
      shared.microphone_device_id || undefined,
      shared.phrase_list.length > 0 ? shared.phrase_list : undefined,
    );
  },

  // Placeholder — will be replaced with actual Svelte component in Phase 3
  SettingsComponent: WhisperSettingsTab as any,
};

export default whisperPlugin;
