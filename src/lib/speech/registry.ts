// ---------------------------------------------------------------------------
// Speech Provider Plugin Registry
// ---------------------------------------------------------------------------
//
// Each speech service is packaged as a plugin that self-describes its
// capabilities, settings component, and optional popup overlay. The registry
// replaces all hardcoded provider lists in the codebase.
// ---------------------------------------------------------------------------

import type { SpeechProvider, SpeechCallbacks, AudioDevice } from "./types";
import type { Component } from "svelte";

// ---------------------------------------------------------------------------
// Capability flags — used by Popup / Settings UI to enable features
// without checking provider IDs directly.
// ---------------------------------------------------------------------------

export type ProviderCapability =
  | "realtime-metrics"    // Provider emits decode latency, RTF, backend info
  | "multi-language"      // Supports selecting multiple languages simultaneously
  | "audio-level"         // Provider reports audio level via onAudioLevel
  | "phrase-list"         // Supports custom phrase/vocabulary hints
  | "auto-punctuation"    // Has a toggle for automatic punctuation
  | "requires-backend"    // Needs Rust-side server/process management
  | "local-model";        // Uses locally downloaded models

// ---------------------------------------------------------------------------
// Shared config — settings common to all providers
// ---------------------------------------------------------------------------

export interface SharedConfig {
  microphone_device_id: string;
  phrase_list: string[];
  silence_timeout_seconds: number;
}

// ---------------------------------------------------------------------------
// Language entry — describes a single selectable language.
// ---------------------------------------------------------------------------

export interface LanguageEntry {
  /** BCP 47 language code, e.g. "en-US". */
  readonly code: string;
  /** Human-readable label, e.g. "English (US)". */
  readonly label: string;
}

/** How the provider handles language selection in the UI. */
export type LanguageMode = "single" | "multi" | "none";

/** Where the provider's recognition logic runs. */
export type ExecutionContext = "browser" | "native" | "hybrid";

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface CanStartResult {
  ready: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface SpeechProviderPlugin {
  /** Unique provider identifier, e.g. "os", "azure", "whisper". */
  readonly id: string;
  /** Human-readable label shown in the UI, e.g. "Web Speech". */
  readonly label: string;
  /** Short description of the provider. */
  readonly description?: string;

  /** Capability flags for UI feature gating. */
  readonly capabilities: ReadonlySet<ProviderCapability>;

  /**
   * Where the provider's speech recognition logic runs.
   * - `"browser"` — entirely in TypeScript/WebView (Web Speech, Azure SDK)
   * - `"native"` — entirely in Rust via `NativeSpeechProvider` trait
   *   (Apple Speech, Windows Speech). TS side uses `NativeProviderProxy`.
   * - `"hybrid"` — TS captures audio, Rust processes (Whisper)
   */
  readonly executionContext: ExecutionContext;

  // -------------------------------------------------------------------------
  // Language metadata — drives the Popup language selector dynamically.
  // -------------------------------------------------------------------------

  /** Languages this provider supports.  Shown in Settings + Popup selector. */
  readonly supportedLanguages: readonly LanguageEntry[];

  /**
   * How language selection works for this provider.
   * - `"single"` — one language at a time (OS, Whisper, Apple, Qwen, …)
   * - `"multi"` — multiple languages simultaneously (Azure auto-detect)
   * - `"none"` — provider auto-detects language, no selector shown
   */
  readonly languageMode: LanguageMode;

  /**
   * The key inside `provider_configs[id]` that holds the selected language(s).
   * - For `"single"` mode: value is a `string` (e.g. `"en-US"`).
   * - For `"multi"` mode: value is a `string[]` (e.g. `["en-US", "de-DE"]`).
   * - For `"none"` mode: this field is ignored.
   * Example: `"language"` or `"languages"`.
   */
  readonly languageConfigKey: string;

  // -------------------------------------------------------------------------
  // Provider lifecycle
  // -------------------------------------------------------------------------

  /** Create a provider instance from its config + shared config. */
  createProvider(
    config: Record<string, unknown>,
    shared: SharedConfig,
  ): SpeechProvider;

  /** Return default config values for this provider. */
  defaultConfig(): Record<string, unknown>;

  /**
   * Synchronous check whether the provider can start dictation.
   * Returns `{ ready: true }` or `{ ready: false, error: "..." }`.
   * Error messages are shown verbatim in the Popup.
   */
  canStart(config: Record<string, unknown>): CanStartResult;

  /**
   * Optional async validation for providers that need Rust backend
   * roundtrips (e.g. Whisper model download check, OS permission query).
   * When present, the Popup calls this instead of `canStart()` before
   * recording.  If absent, `canStart()` is used.
   */
  canStartAsync?(config: Record<string, unknown>): Promise<CanStartResult>;

  /** Svelte 5 component rendered inside the Speech settings tab. */
  readonly SettingsComponent: Component<SettingsTabProps>;
}

// ---------------------------------------------------------------------------
// Standard props for settings tab sub-components
// ---------------------------------------------------------------------------

export interface SettingsTabProps {
  config: Record<string, unknown>;
  audioDevices: AudioDevice[];
  micWarning: string;
  microphoneDeviceId?: string;
  isMac?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

class SpeechProviderRegistry {
  private plugins: Map<string, SpeechProviderPlugin> = new Map();
  private order: string[] = [];

  /** Register a plugin. Registration order determines UI tab order. */
  register(plugin: SpeechProviderPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Speech provider "${plugin.id}" is already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
    this.order.push(plugin.id);
  }

  /** Get a plugin by ID, or undefined if not found. */
  get(id: string): SpeechProviderPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Get all registered plugins in registration order. */
  getAll(): SpeechProviderPlugin[] {
    return this.order.map((id) => this.plugins.get(id)!);
  }

  /** Get all registered provider IDs in order. */
  getIds(): string[] {
    return [...this.order];
  }

  /** Get the display label for a provider ID. */
  getLabel(id: string): string {
    return this.plugins.get(id)?.label ?? id;
  }

  /** Cycle to the next provider in registration order. */
  cycle(current: string): string {
    const idx = this.order.indexOf(current);
    if (idx === -1) return this.order[0] ?? current;
    return this.order[(idx + 1) % this.order.length];
  }

  /** Number of registered plugins. */
  get size(): number {
    return this.plugins.size;
  }
}

/** Singleton registry — plugins register at import time. */
export const providerRegistry = new SpeechProviderRegistry();
