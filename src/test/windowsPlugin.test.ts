import { describe, it, expect, vi, beforeEach } from "vitest";
import windowsPlugin from "../lib/speech/plugins/windows";
import { NativeProviderProxy } from "../lib/speech/NativeProviderProxy";
import { invoke } from "@tauri-apps/api/core";

describe("Windows Speech plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it("has correct id and label", () => {
    expect(windowsPlugin.id).toBe("windows");
    expect(windowsPlugin.label).toBe("Windows Speech");
  });

  it("has native execution context", () => {
    expect(windowsPlugin.executionContext).toBe("native");
  });

  it("has auto-punctuation capability", () => {
    expect(windowsPlugin.capabilities.has("auto-punctuation")).toBe(true);
  });

  it("uses single language mode", () => {
    expect(windowsPlugin.languageMode).toBe("single");
    expect(windowsPlugin.languageConfigKey).toBe("language");
  });

  it("provides sensible default config", () => {
    const config = windowsPlugin.defaultConfig();
    expect(config.language).toBe("en-US");
  });

  it("canStart returns ready", () => {
    const result = windowsPlugin.canStart({});
    expect(result.ready).toBe(true);
  });

  it("canStartAsync checks native availability", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const result = await windowsPlugin.canStartAsync!({});
    expect(result.ready).toBe(true);
    expect(invoke).toHaveBeenCalledWith("native_speech_available", {
      providerId: "windows",
    });
  });

  it("canStartAsync returns error when not available", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const result = await windowsPlugin.canStartAsync!({});
    expect(result.ready).toBe(false);
    expect(result.error).toContain("Windows Speech Recognition");
  });

  it("createProvider returns NativeProviderProxy", () => {
    const provider = windowsPlugin.createProvider(
      { language: "de-DE" },
      { microphone_device_id: "mic-1", phrase_list: [], silence_timeout_seconds: 5 },
    );
    expect(provider).toBeInstanceOf(NativeProviderProxy);
  });

  it("createProvider passes config and shared microphone", () => {
    const provider = windowsPlugin.createProvider(
      { language: "ja-JP" },
      { microphone_device_id: "mic-3", phrase_list: [], silence_timeout_seconds: 5 },
    );
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };
    provider.start(callbacks);
    expect(invoke).toHaveBeenCalledWith("native_speech_start", {
      providerId: "windows",
      config: { language: "ja-JP", microphone: "mic-3" },
    });
  });

  it("has a SettingsComponent", () => {
    expect(windowsPlugin.SettingsComponent).toBeDefined();
  });
});
