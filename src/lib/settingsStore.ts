import { tauriInvoke } from "./tauriInvoke";

// Re-export speech reference data for backward compatibility
export { AZURE_REGIONS, SUPPORTED_LANGUAGES } from "./speechConstants";

export interface AppSettings {
  speech_provider: "os" | "azure" | "whisper" | (string & {});
  os_language: string;
  os_auto_restart: boolean;
  os_max_restarts: number;
  azure_speech_key: string;
  azure_region: string;
  whisper_model: string;
  whisper_language: string;
  whisper_chunk_seconds: number;
  whisper_decode_interval: number;
  whisper_context_overlap: number;
  whisper_cli_version: string;
  whisper_cli_variant: string;
  whisper_use_gpu: boolean;
  languages: string[];
  shortcut: string;
  microphone_device_id: string;
  theme: string;
  phrase_list: string[];
  always_on_top: boolean;
  auto_punctuation: boolean;
  auto_start_recording: boolean;
  silence_timeout_seconds: number;
  history_enabled: boolean;
  history_max_entries: number;
  popup_copy_shortcut: string;
  popup_voice_shortcut: string;
  provider_switch_shortcut: string;
  max_recording_enabled: boolean;
  max_recording_seconds: number;
  autostart_enabled: boolean;
  copilot_enabled: boolean;
  copilot_selected_model: string;
  copilot_selected_enhancer: string;
  copilot_delete_sessions: boolean;
  prompt_enhancer_shortcut: string;
  popup_font: string;
  open_popup_on_start: boolean;
  mcp_enabled: boolean;
  mcp_port: number;
  mcp_timeout_seconds: number;
  show_in_dock: boolean;
  speech_tracing: boolean;
  speech_trace_max_entries: number;
  /** Per-provider configuration, keyed by provider ID. */
  provider_configs: Record<string, Record<string, unknown>>;
}

// DEFAULT_SETTINGS must stay in sync with `impl Default for AppSettings` in
// src-tauri/src/settings.rs.  When adding a field, update both files.
export const DEFAULT_SETTINGS: AppSettings = {
  speech_provider: "os",
  os_language: "en-US",
  os_auto_restart: true,
  os_max_restarts: 3,
  azure_speech_key: "",
  azure_region: "eastus",
  whisper_model: "base",
  whisper_language: "en-US",
  whisper_chunk_seconds: 3,
  whisper_decode_interval: 1,
  whisper_context_overlap: 1,
  whisper_cli_version: "1.8.3",
  whisper_cli_variant: "cpu",
  whisper_use_gpu: false,
  languages: ["en-US"],
  shortcut: "CommandOrControl+Alt+V",
  microphone_device_id: "",
  theme: "dark",
  phrase_list: [],
  always_on_top: false,
  auto_punctuation: true,
  auto_start_recording: false,
  silence_timeout_seconds: 30,
  history_enabled: true,
  history_max_entries: 50,
  popup_copy_shortcut: "CommandOrControl+Enter",
  popup_voice_shortcut: "CommandOrControl+Shift+M",
  provider_switch_shortcut: "CommandOrControl+Shift+P",
  max_recording_enabled: true,
  max_recording_seconds: 180,
  autostart_enabled: false,
  copilot_enabled: false,
  copilot_selected_model: "",
  copilot_selected_enhancer: "",
  copilot_delete_sessions: true,
  prompt_enhancer_shortcut: "CommandOrControl+Shift+E",
  popup_font: "mono",
  open_popup_on_start: true,
  mcp_enabled: false,
  mcp_port: 31337,
  mcp_timeout_seconds: 300,
  show_in_dock: false,
  speech_tracing: false,
  speech_trace_max_entries: 500,
  provider_configs: {},
};

export async function getSettings(): Promise<AppSettings> {
  const settings = await tauriInvoke<AppSettings>("get_settings");
  return migrateProviderConfigs(settings);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await tauriInvoke("save_settings", { settings });
}

// ---------------------------------------------------------------------------
// Provider config migration — moves flat fields into provider_configs map
// ---------------------------------------------------------------------------

/**
 * If `provider_configs` is empty, populate it from the legacy flat fields.
 * This runs on every load so old settings files are transparently upgraded.
 * The flat fields are preserved for backward compatibility during the transition.
 */
export function migrateProviderConfigs(settings: AppSettings): AppSettings {
  if (settings.provider_configs && Object.keys(settings.provider_configs).length > 0) {
    return settings; // Already migrated
  }

  const provider_configs: Record<string, Record<string, unknown>> = {
    os: {
      language: settings.os_language ?? DEFAULT_SETTINGS.os_language,
      auto_restart: settings.os_auto_restart ?? DEFAULT_SETTINGS.os_auto_restart,
      max_restarts: settings.os_max_restarts ?? DEFAULT_SETTINGS.os_max_restarts,
    },
    azure: {
      speech_key: settings.azure_speech_key ?? DEFAULT_SETTINGS.azure_speech_key,
      region: settings.azure_region ?? DEFAULT_SETTINGS.azure_region,
      languages: settings.languages ?? DEFAULT_SETTINGS.languages,
      auto_punctuation: settings.auto_punctuation ?? DEFAULT_SETTINGS.auto_punctuation,
    },
    whisper: {
      model: settings.whisper_model ?? DEFAULT_SETTINGS.whisper_model,
      language: settings.whisper_language ?? DEFAULT_SETTINGS.whisper_language,
      decode_interval: settings.whisper_decode_interval ?? DEFAULT_SETTINGS.whisper_decode_interval,
      context_overlap: settings.whisper_context_overlap ?? DEFAULT_SETTINGS.whisper_context_overlap,
      use_gpu: settings.whisper_use_gpu ?? DEFAULT_SETTINGS.whisper_use_gpu,
      cli_version: settings.whisper_cli_version ?? DEFAULT_SETTINGS.whisper_cli_version,
      cli_variant: settings.whisper_cli_variant ?? DEFAULT_SETTINGS.whisper_cli_variant,
      chunk_seconds: settings.whisper_chunk_seconds ?? DEFAULT_SETTINGS.whisper_chunk_seconds,
    },
  };

  return { ...settings, provider_configs };
}
