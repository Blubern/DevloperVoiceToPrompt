import { describe, it, expect, vi, beforeEach } from "vitest";
import applePlugin from "../lib/speech/plugins/apple";
import { NativeProviderProxy } from "../lib/speech/NativeProviderProxy";
import { invoke } from "@tauri-apps/api/core";

describe("Apple Speech plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("has correct id and label", () => {
    expect(applePlugin.id).toBe("apple");
    expect(applePlugin.label).toBe("Apple Speech");
  });

  it("has native execution context", () => {
    expect(applePlugin.executionContext).toBe("native");
  });

  it("has auto-punctuation capability", () => {
    expect(applePlugin.capabilities.has("auto-punctuation")).toBe(true);
  });

  it("uses single language mode", () => {
    expect(applePlugin.languageMode).toBe("single");
    expect(applePlugin.languageConfigKey).toBe("language");
  });

  it("provides sensible default config", () => {
    const config = applePlugin.defaultConfig();
    expect(config.language).toBe("en-US");
    expect(config.on_device).toBe(false);
  });

  it("canStart returns ready", () => {
    const result = applePlugin.canStart({});
    expect(result.ready).toBe(true);
  });

  it("canStartAsync checks native availability", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const result = await applePlugin.canStartAsync!({});
    expect(result.ready).toBe(true);
    expect(invoke).toHaveBeenCalledWith("native_speech_available", {
      providerId: "apple",
    });
  });

  it("canStartAsync returns error when not available", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await applePlugin.canStartAsync!({});
    expect(result.ready).toBe(false);
    expect(result.error).toContain("Apple Speech Recognition");
  });

  it("createProvider returns NativeProviderProxy", () => {
    const provider = applePlugin.createProvider(
      { language: "de-DE", on_device: true },
      { microphone_device_id: "mic-1", phrase_list: [], silence_timeout_seconds: 5 },
    );
    expect(provider).toBeInstanceOf(NativeProviderProxy);
  });

  it("createProvider passes config and shared microphone", () => {
    const provider = applePlugin.createProvider(
      { language: "fr-FR", on_device: false },
      { microphone_device_id: "mic-2", phrase_list: [], silence_timeout_seconds: 5 },
    );
    // Start the provider to verify the config is passed through
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };
    provider.start(callbacks);
    expect(invoke).toHaveBeenCalledWith("native_speech_start", {
      providerId: "apple",
      config: { language: "fr-FR", on_device: false, microphone: "mic-2" },
    });
  });

  it("has a SettingsComponent", () => {
    expect(applePlugin.SettingsComponent).toBeDefined();
  });
});
