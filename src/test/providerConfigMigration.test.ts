import { describe, it, expect } from "vitest";
import { migrateProviderConfigs, DEFAULT_SETTINGS } from "../lib/settingsStore";
import type { AppSettings } from "../lib/settingsStore";

// ---------------------------------------------------------------------------
// migrateProviderConfigs
// ---------------------------------------------------------------------------

describe("migrateProviderConfigs", () => {
  it("populates provider_configs from flat fields when empty", () => {
    const input: AppSettings = {
      ...DEFAULT_SETTINGS,
      os_language: "de-DE",
      azure_speech_key: "test-key",
      azure_region: "westeurope",
      whisper_model: "large-v3",
      provider_configs: {},
    };

    const result = migrateProviderConfigs(input);

    expect(result.provider_configs.os).toEqual({
      language: "de-DE",
      auto_restart: DEFAULT_SETTINGS.os_auto_restart,
      max_restarts: DEFAULT_SETTINGS.os_max_restarts,
    });

    expect(result.provider_configs.azure).toEqual({
      speech_key: "test-key",
      region: "westeurope",
      languages: DEFAULT_SETTINGS.languages,
      auto_punctuation: DEFAULT_SETTINGS.auto_punctuation,
    });

    expect(result.provider_configs.whisper).toMatchObject({
      model: "large-v3",
      language: DEFAULT_SETTINGS.whisper_language,
    });
  });

  it("preserves existing provider_configs when already populated", () => {
    const existing = {
      os: { language: "fr-FR", auto_restart: false, max_restarts: 1 },
    };

    const input: AppSettings = {
      ...DEFAULT_SETTINGS,
      os_language: "de-DE", // flat field differs — should be ignored
      provider_configs: existing,
    };

    const result = migrateProviderConfigs(input);
    // Should return unchanged — migration is a no-op
    expect(result.provider_configs).toBe(existing);
    expect(result.provider_configs.os.language).toBe("fr-FR");
  });

  it("uses default values for undefined flat fields", () => {
    // Simulate very old settings missing some flat fields
    const input = { ...DEFAULT_SETTINGS, provider_configs: {} } as AppSettings;
    // Clear a few flat fields to trigger fallback to defaults
    (input as any).os_language = undefined;
    (input as any).whisper_model = undefined;

    const result = migrateProviderConfigs(input);

    expect(result.provider_configs.os.language).toBe(DEFAULT_SETTINGS.os_language);
    expect(result.provider_configs.whisper.model).toBe(DEFAULT_SETTINGS.whisper_model);
  });

  it("maps all Whisper flat fields correctly", () => {
    const input: AppSettings = {
      ...DEFAULT_SETTINGS,
      whisper_model: "tiny.en",
      whisper_language: "ja-JP",
      whisper_decode_interval: 2,
      whisper_context_overlap: 0.5,
      whisper_use_gpu: true,
      whisper_cli_version: "2.0.0",
      whisper_cli_variant: "cuda12",
      whisper_chunk_seconds: 5,
      provider_configs: {},
    };

    const result = migrateProviderConfigs(input);
    expect(result.provider_configs.whisper).toEqual({
      model: "tiny.en",
      language: "ja-JP",
      decode_interval: 2,
      context_overlap: 0.5,
      use_gpu: true,
      cli_version: "2.0.0",
      cli_variant: "cuda12",
      chunk_seconds: 5,
    });
  });

  it("does not mutate the original settings object", () => {
    const input: AppSettings = { ...DEFAULT_SETTINGS, provider_configs: {} };
    const original = JSON.parse(JSON.stringify(input));

    migrateProviderConfigs(input);

    // Original should be unchanged
    expect(input.provider_configs).toEqual({});
    expect(JSON.stringify(input)).toBe(JSON.stringify(original));
  });
});
