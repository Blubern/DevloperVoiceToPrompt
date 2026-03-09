// ---------------------------------------------------------------------------
// speechService.ts — Barrel re-export for backward compatibility.
// Actual implementations live in src/lib/speech/*.ts
// ---------------------------------------------------------------------------

import type { AppSettings } from "./settingsStore";
import type { SpeechProvider } from "./speech/types";
import { PROVIDER_AZURE, PROVIDER_WHISPER } from "./constants";
import { OsSpeechProvider } from "./speech/OsSpeechProvider";
import { AzureSpeechProvider } from "./speech/AzureSpeechProvider";
import { WhisperSpeechProvider } from "./speech/WhisperSpeechProvider";

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

// Re-export provider classes
export { OsSpeechProvider } from "./speech/OsSpeechProvider";
export { AzureSpeechProvider } from "./speech/AzureSpeechProvider";
export { WhisperSpeechProvider, revokeWorkletUrl } from "./speech/WhisperSpeechProvider";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSpeechProvider(settings: AppSettings): SpeechProvider {
  if (settings.speech_provider === PROVIDER_AZURE) {
    return new AzureSpeechProvider(
      settings.azure_speech_key,
      settings.azure_region,
      settings.languages,
      settings.microphone_device_id || undefined,
      settings.phrase_list.length > 0 ? settings.phrase_list : undefined,
      settings.auto_punctuation,
    );
  }
  if (settings.speech_provider === PROVIDER_WHISPER) {
    return new WhisperSpeechProvider(
      settings.whisper_model,
      settings.whisper_language,
      settings.whisper_decode_interval,
      settings.whisper_context_overlap,
      settings.microphone_device_id || undefined,
      settings.phrase_list.length > 0 ? settings.phrase_list : undefined,
    );
  }
  return new OsSpeechProvider(
    settings.os_language,
    settings.os_auto_restart,
    settings.os_max_restarts,
  );
}
