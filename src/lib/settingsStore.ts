import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  speech_provider: "os" | "azure" | "whisper";
  os_language: string;
  os_auto_restart: boolean;
  os_max_restarts: number;
  azure_speech_key: string;
  azure_region: string;
  whisper_model: string;
  whisper_language: string;
  whisper_chunk_seconds: number;
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
  prompt_enhancer_shortcut: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  speech_provider: "os",
  os_language: "en-US",
  os_auto_restart: true,
  os_max_restarts: 3,
  azure_speech_key: "",
  azure_region: "eastus",
  whisper_model: "base",
  whisper_language: "en-US",
  whisper_chunk_seconds: 5,
  languages: ["en-US"],
  shortcut: "CommandOrControl+Alt+V",
  microphone_device_id: "",
  theme: "dark",
  phrase_list: [],
  always_on_top: true,
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
  prompt_enhancer_shortcut: "CommandOrControl+Shift+E",
};

export const AZURE_REGIONS = [
  { value: "eastus", label: "East US" },
  { value: "eastus2", label: "East US 2" },
  { value: "westus", label: "West US" },
  { value: "westus2", label: "West US 2" },
  { value: "westus3", label: "West US 3" },
  { value: "centralus", label: "Central US" },
  { value: "northcentralus", label: "North Central US" },
  { value: "southcentralus", label: "South Central US" },
  { value: "canadacentral", label: "Canada Central" },
  { value: "brazilsouth", label: "Brazil South" },
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "uksouth", label: "UK South" },
  { value: "ukwest", label: "UK West" },
  { value: "francecentral", label: "France Central" },
  { value: "germanywestcentral", label: "Germany West Central" },
  { value: "switzerlandnorth", label: "Switzerland North" },
  { value: "swedencentral", label: "Sweden Central" },
  { value: "norwayeast", label: "Norway East" },
  { value: "eastasia", label: "East Asia" },
  { value: "southeastasia", label: "Southeast Asia" },
  { value: "japaneast", label: "Japan East" },
  { value: "japanwest", label: "Japan West" },
  { value: "koreacentral", label: "Korea Central" },
  { value: "centralindia", label: "Central India" },
  { value: "australiaeast", label: "Australia East" },
  { value: "uaenorth", label: "UAE North" },
  { value: "southafricanorth", label: "South Africa North" },
];

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await invoke("save_settings", { settings });
}

export const SUPPORTED_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "de-DE", label: "German (Germany)" },
  { code: "de-AT", label: "German (Austria)" },
  { code: "de-CH", label: "German (Switzerland)" },
  { code: "fr-FR", label: "French (France)" },
  { code: "fr-CA", label: "French (Canada)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "pl-PL", label: "Polish" },
  { code: "sv-SE", label: "Swedish" },
  { code: "da-DK", label: "Danish" },
  { code: "fi-FI", label: "Finnish" },
  { code: "nb-NO", label: "Norwegian" },
  { code: "ru-RU", label: "Russian" },
  { code: "uk-UA", label: "Ukrainian" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ar-SA", label: "Arabic (Saudi)" },
  { code: "tr-TR", label: "Turkish" },
  { code: "cs-CZ", label: "Czech" },
  { code: "ro-RO", label: "Romanian" },
  { code: "hu-HU", label: "Hungarian" },
  { code: "th-TH", label: "Thai" },
  { code: "vi-VN", label: "Vietnamese" },
  { code: "id-ID", label: "Indonesian" },
  { code: "he-IL", label: "Hebrew" },
];
