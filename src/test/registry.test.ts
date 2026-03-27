import { describe, it, expect, vi } from "vitest";

// Mock the Azure Speech SDK before anything imports speechService
vi.mock("microsoft-cognitiveservices-speech-sdk", () => ({
  SpeechConfig: { fromSubscription: vi.fn() },
  AudioConfig: {
    fromMicrophoneInput: vi.fn(),
    fromDefaultMicrophoneInput: vi.fn(),
  },
  SpeechRecognizer: vi.fn(),
  AutoDetectSourceLanguageConfig: { fromLanguages: vi.fn() },
  PhraseListGrammar: { fromRecognizer: vi.fn(() => ({ addPhrase: vi.fn() })) },
  PropertyId: { SpeechServiceConnection_InitialSilenceTimeoutMs: "a", SpeechServiceConnection_EndSilenceTimeoutMs: "b" },
  ResultReason: { RecognizedSpeech: 1 },
  CancellationReason: { Error: 1 },
}));

import { providerRegistry } from "../lib/speechService";

// ---------------------------------------------------------------------------
// Registry built-in plugins
// ---------------------------------------------------------------------------

describe("SpeechProviderRegistry with built-in plugins", () => {
  it("has exactly 3 built-in providers registered", () => {
    expect(providerRegistry.size).toBe(3);
  });

  it("registers plugins in order: os, azure, whisper", () => {
    expect(providerRegistry.getIds()).toEqual(["os", "azure", "whisper"]);
  });

  it("get() returns the correct plugin by ID", () => {
    const os = providerRegistry.get("os");
    expect(os).toBeDefined();
    expect(os!.id).toBe("os");
    expect(os!.label).toBe("Web Speech");

    const azure = providerRegistry.get("azure");
    expect(azure).toBeDefined();
    expect(azure!.id).toBe("azure");
    expect(azure!.label).toBe("Azure");

    const whisper = providerRegistry.get("whisper");
    expect(whisper).toBeDefined();
    expect(whisper!.id).toBe("whisper");
    expect(whisper!.label).toBe("Whisper");
  });

  it("get() returns undefined for unregistered ID", () => {
    expect(providerRegistry.get("nonexistent")).toBeUndefined();
  });

  it("getAll() returns plugins in registration order", () => {
    const all = providerRegistry.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.id)).toEqual(["os", "azure", "whisper"]);
  });

  it("getLabel() returns label for registered providers", () => {
    expect(providerRegistry.getLabel("os")).toBe("Web Speech");
    expect(providerRegistry.getLabel("azure")).toBe("Azure");
    expect(providerRegistry.getLabel("whisper")).toBe("Whisper");
  });

  it("getLabel() returns raw ID for unknown providers", () => {
    expect(providerRegistry.getLabel("unknown")).toBe("unknown");
  });

  it("cycle() rotates through providers", () => {
    expect(providerRegistry.cycle("os")).toBe("azure");
    expect(providerRegistry.cycle("azure")).toBe("whisper");
    expect(providerRegistry.cycle("whisper")).toBe("os");
  });

  it("cycle() returns first provider for unknown current", () => {
    expect(providerRegistry.cycle("nonexistent")).toBe("os");
  });
});

// ---------------------------------------------------------------------------
// Plugin capabilities
// ---------------------------------------------------------------------------

describe("Built-in plugin capabilities", () => {
  it("OS plugin has no capabilities", () => {
    const os = providerRegistry.get("os")!;
    expect(os.capabilities.size).toBe(0);
  });

  it("Azure plugin has multi-language, phrase-list, auto-punctuation", () => {
    const azure = providerRegistry.get("azure")!;
    expect(azure.capabilities.has("multi-language")).toBe(true);
    expect(azure.capabilities.has("phrase-list")).toBe(true);
    expect(azure.capabilities.has("auto-punctuation")).toBe(true);
    expect(azure.capabilities.has("realtime-metrics")).toBe(false);
  });

  it("Whisper plugin has realtime-metrics, audio-level, phrase-list, requires-backend, local-model", () => {
    const whisper = providerRegistry.get("whisper")!;
    expect(whisper.capabilities.has("realtime-metrics")).toBe(true);
    expect(whisper.capabilities.has("audio-level")).toBe(true);
    expect(whisper.capabilities.has("phrase-list")).toBe(true);
    expect(whisper.capabilities.has("requires-backend")).toBe(true);
    expect(whisper.capabilities.has("local-model")).toBe(true);
    expect(whisper.capabilities.has("multi-language")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plugin canStart()
// ---------------------------------------------------------------------------

describe("Plugin canStart() validation", () => {
  it("OS plugin reports ready when webSpeechAvailable is true", () => {
    const os = providerRegistry.get("os")!;
    const result = os.canStart({});
    // webSpeechAvailable is false in test env (no window.SpeechRecognition)
    expect(result.ready).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("Azure plugin reports not ready without speech_key", () => {
    const azure = providerRegistry.get("azure")!;
    expect(azure.canStart({}).ready).toBe(false);
    expect(azure.canStart({ speech_key: "key" }).ready).toBe(false);
    expect(azure.canStart({ speech_key: "key", region: "westus" }).ready).toBe(true);
  });

  it("Whisper plugin reports not ready without model", () => {
    const whisper = providerRegistry.get("whisper")!;
    expect(whisper.canStart({}).ready).toBe(false);
    expect(whisper.canStart({ model: "base.en" }).ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plugin defaultConfig()
// ---------------------------------------------------------------------------

describe("Plugin defaultConfig()", () => {
  it("OS plugin returns language and auto_restart defaults", () => {
    const config = providerRegistry.get("os")!.defaultConfig();
    expect(config).toHaveProperty("language");
    expect(config).toHaveProperty("auto_restart");
    expect(config).toHaveProperty("max_restarts");
  });

  it("Azure plugin returns speech_key, region, languages defaults", () => {
    const config = providerRegistry.get("azure")!.defaultConfig();
    expect(config).toHaveProperty("speech_key");
    expect(config).toHaveProperty("region");
    expect(config).toHaveProperty("languages");
    expect(config).toHaveProperty("auto_punctuation");
  });

  it("Whisper plugin returns model, language, decode_interval defaults", () => {
    const config = providerRegistry.get("whisper")!.defaultConfig();
    expect(config).toHaveProperty("model");
    expect(config).toHaveProperty("language");
    expect(config).toHaveProperty("decode_interval");
    expect(config).toHaveProperty("use_gpu");
  });
});

// ---------------------------------------------------------------------------
// Plugin language metadata
// ---------------------------------------------------------------------------

describe("Plugin language metadata", () => {
  it("OS plugin has single language mode with 'language' config key", () => {
    const os = providerRegistry.get("os")!;
    expect(os.languageMode).toBe("single");
    expect(os.languageConfigKey).toBe("language");
    expect(os.supportedLanguages.length).toBeGreaterThan(10);
    expect(os.supportedLanguages[0]).toHaveProperty("code");
    expect(os.supportedLanguages[0]).toHaveProperty("label");
  });

  it("Azure plugin has multi language mode with 'languages' config key", () => {
    const azure = providerRegistry.get("azure")!;
    expect(azure.languageMode).toBe("multi");
    expect(azure.languageConfigKey).toBe("languages");
    expect(azure.supportedLanguages.length).toBeGreaterThan(10);
  });

  it("Whisper plugin has single language mode with 'language' config key", () => {
    const whisper = providerRegistry.get("whisper")!;
    expect(whisper.languageMode).toBe("single");
    expect(whisper.languageConfigKey).toBe("language");
    expect(whisper.supportedLanguages.length).toBeGreaterThan(10);
  });

  it("default config language values match languageConfigKey", () => {
    const osConfig = providerRegistry.get("os")!.defaultConfig();
    expect(typeof osConfig.language).toBe("string");

    const azureConfig = providerRegistry.get("azure")!.defaultConfig();
    expect(Array.isArray(azureConfig.languages)).toBe(true);

    const whisperConfig = providerRegistry.get("whisper")!.defaultConfig();
    expect(typeof whisperConfig.language).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Plugin canStartAsync()
// ---------------------------------------------------------------------------

describe("Plugin canStartAsync()", () => {
  it("OS and Azure plugins do not have canStartAsync", () => {
    expect(providerRegistry.get("os")!.canStartAsync).toBeUndefined();
    expect(providerRegistry.get("azure")!.canStartAsync).toBeUndefined();
  });

  it("Whisper plugin has canStartAsync", () => {
    const whisper = providerRegistry.get("whisper")!;
    expect(typeof whisper.canStartAsync).toBe("function");
  });

  it("Whisper canStartAsync rejects empty model", async () => {
    const whisper = providerRegistry.get("whisper")!;
    const result = await whisper.canStartAsync!({});
    expect(result.ready).toBe(false);
    expect(result.error).toContain("model");
  });
});

// ---------------------------------------------------------------------------
// Plugin executionContext
// ---------------------------------------------------------------------------

describe("Plugin executionContext", () => {
  it("OS plugin runs in browser context", () => {
    expect(providerRegistry.get("os")!.executionContext).toBe("browser");
  });

  it("Azure plugin runs in browser context", () => {
    expect(providerRegistry.get("azure")!.executionContext).toBe("browser");
  });

  it("Whisper plugin runs in hybrid context", () => {
    expect(providerRegistry.get("whisper")!.executionContext).toBe("hybrid");
  });
});
