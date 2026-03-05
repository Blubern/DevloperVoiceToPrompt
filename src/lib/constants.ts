// Window labels used by Tauri
export const WINDOW_MAIN = "main" as const;
export const WINDOW_POPUP = "popup" as const;

// Speech provider identifiers
export const PROVIDER_OS = "os" as const;
export const PROVIDER_AZURE = "azure" as const;
export const PROVIDER_WHISPER = "whisper" as const;

export const PROVIDER_ORDER = [PROVIDER_OS, PROVIDER_AZURE, PROVIDER_WHISPER] as const;

export function cycleProvider(
  current: SpeechProviderType,
): SpeechProviderType {
  const idx = PROVIDER_ORDER.indexOf(current);
  return PROVIDER_ORDER[(idx + 1) % PROVIDER_ORDER.length];
}

export function providerLabel(p: SpeechProviderType): string {
  if (p === PROVIDER_OS) return "Web";
  if (p === PROVIDER_AZURE) return "Azure";
  return "Whisper";
}

// Tauri custom event names
export const EVENT_SETTINGS_UPDATED = "settings-updated" as const;
export const EVENT_TEMPLATES_UPDATED = "templates-updated" as const;
export const EVENT_ENHANCER_TEMPLATES_UPDATED = "enhancer-templates-updated" as const;
export const EVENT_CHECK_FIRST_RUN = "check-first-run" as const;
export const EVENT_WHISPER_DOWNLOAD_PROGRESS = "whisper-download-progress" as const;

// Timer defaults
export const DEFAULT_SILENCE_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_RECORDING_SECONDS = 180;

// Whisper silence detection threshold (RMS energy)
export const WHISPER_SILENCE_RMS_THRESHOLD = 0.01;

// Types
export type SpeechProviderType = typeof PROVIDER_OS | typeof PROVIDER_AZURE | typeof PROVIDER_WHISPER;
export type RecordingStatus = "idle" | "listening" | "error";
export type WindowLabel = typeof WINDOW_MAIN | typeof WINDOW_POPUP;
