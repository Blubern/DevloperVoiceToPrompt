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
export const EVENT_MCP_VOICE_REQUEST = "mcp-voice-request" as const;
export const EVENT_COPILOT_BRIDGE_STATE = "copilot-bridge-state" as const;

// Timer defaults
export const DEFAULT_SILENCE_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_RECORDING_SECONDS = 180;

// Whisper silence detection threshold (RMS energy)
export const WHISPER_SILENCE_RMS_THRESHOLD = 0.01;

// Whisper realtime defaults
/** Default decode cadence in seconds (how often we send audio to Whisper). */
export const WHISPER_DEFAULT_DECODE_INTERVAL = 1;
/** Minimum allowed decode interval in seconds. */
export const WHISPER_MIN_DECODE_INTERVAL = 0.5;
/** Maximum allowed decode interval in seconds. */
export const WHISPER_MAX_DECODE_INTERVAL = 10;
/** Default overlap window in seconds kept from previous decode for context. */
export const WHISPER_DEFAULT_CONTEXT_OVERLAP = 1;
/** How many consecutive stable decode results before committing interim to final. */
export const WHISPER_STABILITY_COUNT = 2;

// Prompt enhancer system prompt wrapper
export const ENHANCE_SYSTEM_PROMPT_WRAPPER = `You are a text-only prompt enhancer. You have no access to files, tools, or external resources. Your sole task is to process the raw dictated text provided by the user. Apply the following enhancement instructions, then output ONLY the final enhanced text with no explanations, commentary, or markdown formatting.

Enhancement instructions:
`;

// Types
export type SpeechProviderType = typeof PROVIDER_OS | typeof PROVIDER_AZURE | typeof PROVIDER_WHISPER;
export type RecordingStatus = "idle" | "listening" | "error";
export type WindowLabel = typeof WINDOW_MAIN | typeof WINDOW_POPUP;

// Font options for the popup editor textarea
export interface FontOption {
  value: string;
  label: string;
  family: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { value: "mono", label: "Monospace (Default)", family: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Courier New', monospace" },
  { value: "cascadia", label: "Cascadia Code", family: "'Cascadia Code', 'Cascadia Mono', monospace" },
  { value: "firacode", label: "Fira Code", family: "'Fira Code', 'Fira Mono', monospace" },
  { value: "jetbrains", label: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
  { value: "consolas", label: "Consolas", family: "'Consolas', monospace" },
  { value: "courier", label: "Courier New", family: "'Courier New', monospace" },
  { value: "ubuntu", label: "Ubuntu Mono", family: "'Ubuntu Mono', monospace" },
  { value: "system", label: "System Sans-Serif", family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { value: "georgia", label: "Georgia", family: "'Georgia', serif" },
  { value: "palatino", label: "Palatino", family: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { value: "garamond", label: "Garamond", family: "'Garamond', 'EB Garamond', serif" },
  { value: "serif", label: "Serif", family: "'Georgia', 'Times New Roman', serif" },
];

/** Lookup map: font setting value → CSS font-family string. */
export const FONT_FAMILIES: Record<string, string> = Object.fromEntries(
  FONT_OPTIONS.map((o) => [o.value, o.family]),
);

export interface McpVoiceRequest {
  input_reason: string;
  context_input: string | null;
}

// About section
export const APP_GITHUB_URL = "https://github.com/Blubern/DevloperVoiceToPrompt";

export interface LibraryInfo {
  name: string;
  description: string;
  url?: string;
  category: "Framework" | "Speech" | "AI" | "Backend" | "Theme" | "Testing";
}

export const ABOUT_LIBRARIES: LibraryInfo[] = [
  { name: "Tauri 2", description: "Desktop app framework with a Rust backend", url: "https://github.com/tauri-apps/tauri", category: "Framework" },
  { name: "Svelte 5", description: "Reactive UI compiler with runes", url: "https://github.com/sveltejs/svelte", category: "Framework" },
  { name: "Vite", description: "Next-generation frontend build tool", url: "https://github.com/vitejs/vite", category: "Framework" },
  { name: "TypeScript", description: "Typed superset of JavaScript", url: "https://github.com/microsoft/TypeScript", category: "Framework" },
  { name: "Azure Speech SDK", description: "Cloud speech-to-text service", url: "https://github.com/microsoft/cognitive-services-speech-sdk-js", category: "Speech" },
  { name: "whisper-rs", description: "Rust bindings for OpenAI Whisper", url: "https://github.com/tazz4843/whisper-rs", category: "Speech" },
  { name: "Web Speech API", description: "Browser-native speech recognition", category: "Speech" },
  { name: "GitHub Copilot SDK", description: "AI-powered prompt enhancement", category: "AI" },
  { name: "Tokio", description: "Async runtime for Rust", url: "https://github.com/tokio-rs/tokio", category: "Backend" },
  { name: "Serde", description: "Serialization framework for Rust", url: "https://github.com/serde-rs/serde", category: "Backend" },
  { name: "Catppuccin", description: "Soothing pastel color theme", url: "https://github.com/catppuccin/catppuccin", category: "Theme" },
  { name: "Vitest", description: "Blazing fast unit testing framework", url: "https://github.com/vitest-dev/vitest", category: "Testing" },
];
