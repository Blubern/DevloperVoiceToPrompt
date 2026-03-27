// ---------------------------------------------------------------------------
// speechService.ts — Barrel re-export + registry-based factory.
// Provider implementations live in src/lib/speech/plugins/*
// ---------------------------------------------------------------------------

import type { AppSettings } from "./settingsStore";
import type { SpeechProvider } from "./speech/types";

// Import plugins/index to ensure all built-in plugins are registered
import { providerRegistry } from "./speech/plugins";
import type { SharedConfig } from "./speech/registry";

// Re-export types
export type { SpeechCallbacks, SpeechProvider, AudioDevice, EnumerateResult } from "./speech/types";

// Re-export helpers
export {
  checkMicrophonePermission,
  enumerateAudioDevices,
  testAzureConnection,
  webSpeechAvailable,
  detectWebSpeechAvailability,
} from "./speech/speechHelpers";

// Re-export provider classes (backward compatibility)
export { OsSpeechProvider } from "./speech/plugins/os/OsSpeechProvider";
export { AzureSpeechProvider } from "./speech/plugins/azure/AzureSpeechProvider";
export { WhisperSpeechProvider, revokeWorkletUrl } from "./speech/plugins/whisper/WhisperSpeechProvider";

// Re-export registry
export { providerRegistry } from "./speech/plugins";
export type { SpeechProviderPlugin, SharedConfig, ProviderCapability, SettingsTabProps, LanguageEntry, LanguageMode, CanStartResult, ExecutionContext } from "./speech/registry";

// Re-export native provider proxy (for use by native plugin descriptors)
export { NativeProviderProxy } from "./speech/NativeProviderProxy";

// ---------------------------------------------------------------------------
// Factory — uses registry with backward-compatible flat-settings bridge
// ---------------------------------------------------------------------------

/**
 * Build a SharedConfig from the flat AppSettings fields that are common to
 * all providers (microphone, phrase list, silence timeout).
 */
function buildSharedConfig(settings: AppSettings): SharedConfig {
  return {
    microphone_device_id: settings.microphone_device_id,
    phrase_list: settings.phrase_list,
    silence_timeout_seconds: settings.silence_timeout_seconds,
  };
}

/**
 * Build the per-provider config from either provider_configs (new) or
 * flat AppSettings fields (legacy / transition).
 */
function buildProviderConfig(settings: AppSettings): Record<string, unknown> {
  // If provider_configs is populated, use it
  if (settings.provider_configs?.[settings.speech_provider]) {
    return settings.provider_configs[settings.speech_provider];
  }

  // Otherwise, bridge from flat fields for backward compatibility
  switch (settings.speech_provider) {
    case "azure":
      return {
        speech_key: settings.azure_speech_key,
        region: settings.azure_region,
        languages: settings.languages,
        auto_punctuation: settings.auto_punctuation,
      };
    case "whisper":
      return {
        model: settings.whisper_model,
        language: settings.whisper_language,
        decode_interval: settings.whisper_decode_interval,
        context_overlap: settings.whisper_context_overlap,
        use_gpu: settings.whisper_use_gpu,
        cli_version: settings.whisper_cli_version,
        cli_variant: settings.whisper_cli_variant,
        chunk_seconds: settings.whisper_chunk_seconds,
      };
    default: // "os"
      return {
        language: settings.os_language,
        auto_restart: settings.os_auto_restart,
        max_restarts: settings.os_max_restarts,
      };
  }
}

export function createSpeechProvider(settings: AppSettings): SpeechProvider {
  const plugin = providerRegistry.get(settings.speech_provider);
  if (!plugin) {
    // Fall back to first registered provider (OS)
    const fallback = providerRegistry.getAll()[0];
    return fallback.createProvider(
      fallback.defaultConfig(),
      buildSharedConfig(settings),
    );
  }
  return plugin.createProvider(
    buildProviderConfig(settings),
    buildSharedConfig(settings),
  );
}
