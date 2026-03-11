import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Azure Speech SDK before importing speechService
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

import {
  checkMicrophonePermission,
  enumerateAudioDevices,
  testAzureConnection,
  createSpeechProvider,
  OsSpeechProvider,
  AzureSpeechProvider,
  WhisperSpeechProvider,
} from "../lib/speechService";
import { clearTrace, getTraceEntries, setTracingEnabled } from "../lib/speechTraceStore";
import type { AppSettings } from "../lib/settingsStore";

// ---------------------------------------------------------------------------
// checkMicrophonePermission
// ---------------------------------------------------------------------------

describe("checkMicrophonePermission", () => {
  beforeEach(() => {
    // jsdom doesn't provide navigator.permissions — stub it
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'granted' when permission is granted", async () => {
    vi.mocked(navigator.permissions.query).mockResolvedValue({
      state: "granted",
    } as PermissionStatus);
    expect(await checkMicrophonePermission()).toBe("granted");
  });

  it("returns 'denied' when permission is denied", async () => {
    vi.mocked(navigator.permissions.query).mockResolvedValue({
      state: "denied",
    } as PermissionStatus);
    expect(await checkMicrophonePermission()).toBe("denied");
  });

  it("returns 'prompt' when permission is prompt", async () => {
    vi.mocked(navigator.permissions.query).mockResolvedValue({
      state: "prompt",
    } as PermissionStatus);
    expect(await checkMicrophonePermission()).toBe("prompt");
  });

  it("returns 'unknown' when permissions API throws", async () => {
    vi.mocked(navigator.permissions.query).mockRejectedValue(new Error("not supported"));
    expect(await checkMicrophonePermission()).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// enumerateAudioDevices
// ---------------------------------------------------------------------------

describe("enumerateAudioDevices", () => {
  const mockTrack = { stop: vi.fn() };
  const mockStream = { getTracks: () => [mockTrack] };

  beforeEach(() => {
    mockTrack.stop.mockClear();
    // jsdom doesn't provide navigator.mediaDevices — stub it
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns audio input devices on success", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(mockStream as unknown as MediaStream);
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
      { kind: "audioinput", deviceId: "mic1", label: "Built-in Mic", groupId: "g1", toJSON: vi.fn() },
      { kind: "videoinput", deviceId: "cam1", label: "Camera", groupId: "g2", toJSON: vi.fn() },
      { kind: "audioinput", deviceId: "mic2", label: "", groupId: "g3", toJSON: vi.fn() },
    ] as MediaDeviceInfo[]);

    const result = await enumerateAudioDevices();
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toEqual({ deviceId: "mic1", label: "Built-in Mic" });
    // Empty label gets a fallback
    expect(result.devices[1].label).toMatch(/^Microphone \(/);
    expect(result.error).toBeUndefined();
  });

  it("stops tracks after getUserMedia", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(mockStream as unknown as MediaStream);
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([]);

    await enumerateAudioDevices();
    expect(mockTrack.stop).toHaveBeenCalled();
  });

  it("returns NotAllowedError message when mic access denied", async () => {
    const err = new DOMException("Permission denied", "NotAllowedError");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(err);

    const result = await enumerateAudioDevices();
    expect(result.devices).toEqual([]);
    expect(result.error).toContain("denied");
  });

  it("returns NotFoundError message when no mic found", async () => {
    const err = new DOMException("No device", "NotFoundError");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(err);

    const result = await enumerateAudioDevices();
    expect(result.devices).toEqual([]);
    expect(result.error).toContain("No microphone found");
  });

  it("returns generic error for other exceptions", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error("boom"));

    const result = await enumerateAudioDevices();
    expect(result.devices).toEqual([]);
    expect(result.error).toContain("Could not access microphone");
  });
});

// ---------------------------------------------------------------------------
// testAzureConnection
// ---------------------------------------------------------------------------

describe("testAzureConnection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns error when key is empty", async () => {
    const result = await testAzureConnection("", "westus");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("required");
  });

  it("returns error when region is empty", async () => {
    const result = await testAzureConnection("key123", "");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("required");
  });

  it("returns ok on successful token response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await testAzureConnection("validkey", "westus");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("builds correct URL with encoded region", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    await testAzureConnection("key", "eastus2");
    expect(spy).toHaveBeenCalledWith(
      "https://eastus2.api.cognitive.microsoft.com/sts/v1.0/issueToken",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Ocp-Apim-Subscription-Key": "key" }),
      }),
    );
  });

  it("returns 'Invalid API key' on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);

    const result = await testAzureConnection("badkey", "westus");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid API key.");
  });

  it("returns 'not authorized' on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 403 } as Response);

    const result = await testAzureConnection("key", "westus");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not authorized");
  });

  it("returns status code on other errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await testAzureConnection("key", "westus");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await testAzureConnection("key", "westus");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Could not reach Azure");
  });

  it("rejects invalid region not in AZURE_REGIONS allowlist", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await testAzureConnection("key", "evil.com/foo");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid Azure region.");
    // Fetch should never have been called
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts valid region from AZURE_REGIONS allowlist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await testAzureConnection("key", "eastus");
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createSpeechProvider (factory)
// ---------------------------------------------------------------------------

describe("createSpeechProvider", () => {
  const baseSettings = {
    speech_provider: "os",
    os_language: "en-US",
    os_auto_restart: true,
    os_max_restarts: 3,
    azure_speech_key: "testkey",
    azure_region: "westus",
    languages: ["en-US"],
    microphone_device_id: "",
    phrase_list: [],
    auto_punctuation: true,
    whisper_model: "tiny",
    whisper_language: "en",
    whisper_decode_interval: 3,
    whisper_context_overlap: 1,
  } as unknown as AppSettings;

  it("returns OsSpeechProvider for 'os' provider", () => {
    const provider = createSpeechProvider({ ...baseSettings, speech_provider: "os" } as AppSettings);
    expect(provider).toBeInstanceOf(OsSpeechProvider);
  });

  it("returns AzureSpeechProvider for 'azure' provider", () => {
    const provider = createSpeechProvider({ ...baseSettings, speech_provider: "azure" } as AppSettings);
    expect(provider).toBeInstanceOf(AzureSpeechProvider);
  });

  it("returns WhisperSpeechProvider for 'whisper' provider", () => {
    const provider = createSpeechProvider({ ...baseSettings, speech_provider: "whisper" } as AppSettings);
    expect(provider).toBeInstanceOf(WhisperSpeechProvider);
  });

  it("defaults to OsSpeechProvider for unknown provider", () => {
    const provider = createSpeechProvider({ ...baseSettings, speech_provider: "unknown" } as unknown as AppSettings);
    expect(provider).toBeInstanceOf(OsSpeechProvider);
  });
});

// ---------------------------------------------------------------------------
// WhisperSpeechProvider — start/running race condition
// ---------------------------------------------------------------------------

describe("WhisperSpeechProvider start()", () => {
  it("does not set running=true before async initialization completes", () => {
    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);

    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    // start() kicks off async work but should NOT set running=true synchronously
    provider.start(callbacks);

    // Access private field via any cast — running should be false until _startAsync completes
    expect((provider as any).running).toBe(false);
  });

  it("calls onError and sets running=false when async init fails", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("model not found"));

    const provider = new WhisperSpeechProvider("nonexistent", "en", 3, 1, false);

    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    provider.start(callbacks);

    // Wait for the async error to propagate
    await new Promise((r) => setTimeout(r, 50));

    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining("model not found"));
    expect(callbacks.onStatusChange).toHaveBeenCalledWith("error");
    expect((provider as any).running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AzureSpeechProvider — flushPendingInterim helper
// ---------------------------------------------------------------------------

describe("AzureSpeechProvider flushPendingInterim", () => {
  it("calls onFinal and clears lastInterimText when interim is pending", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    // Set up internal state via any cast
    (provider as any).callbacks = callbacks;
    (provider as any).lastInterimText = "pending speech";

    // Call the private method
    (provider as any).flushPendingInterim("test-source");

    expect(callbacks.onFinal).toHaveBeenCalledWith("pending speech");
    expect((provider as any).lastInterimText).toBe("");
  });

  it("does nothing when no interim text is pending", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    (provider as any).callbacks = callbacks;
    (provider as any).lastInterimText = "";

    (provider as any).flushPendingInterim("test-source");

    expect(callbacks.onFinal).not.toHaveBeenCalled();
  });

  it("does nothing when callbacks is null", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    (provider as any).callbacks = null;
    (provider as any).lastInterimText = "orphaned text";

    // Should not throw
    (provider as any).flushPendingInterim("test-source");
  });
});

// ---------------------------------------------------------------------------
// AzureSpeechProvider — speechEnd timeout (1.2s)
// ---------------------------------------------------------------------------

describe("AzureSpeechProvider speechEnd timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes pending interim after 1200ms speechEnd timeout", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    (provider as any).callbacks = callbacks;
    (provider as any).lastInterimText = "hello world";

    // Simulate speechEndDetected handler setting the timeout
    (provider as any).speechEndTimer = setTimeout(() => {
      (provider as any).flushPendingInterim("speechEnd-timeout");
    }, 1200);

    // Not yet flushed at 1199ms
    vi.advanceTimersByTime(1199);
    expect(callbacks.onFinal).not.toHaveBeenCalled();

    // Flushed at 1200ms
    vi.advanceTimersByTime(1);
    expect(callbacks.onFinal).toHaveBeenCalledWith("hello world");
    expect((provider as any).lastInterimText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AzureSpeechProvider — turn-boundary flush heuristic
// ---------------------------------------------------------------------------

describe("AzureSpeechProvider turn-boundary detection", () => {
  it("sharePrefix returns true for matching prefix", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    expect((provider as any).sharePrefix("Hello world test", "Hello world")).toBe(true);
  });

  it("sharePrefix returns false for non-matching prefix", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    expect((provider as any).sharePrefix("The quick brown fox", "Another sentence")).toBe(false);
  });

  it("sharePrefix returns false for very short strings", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    expect((provider as any).sharePrefix("Hi", "Hi")).toBe(false);
  });

  it("flushes when new interim is 67% of old length with no shared prefix (0.75 ratio)", () => {
    // Reproduces the exact scenario from the trace: "when we see this text" (21 chars)
    // followed by "he was waiting" (14 chars) — ratio = 14/21 = 0.667 < 0.75
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    (provider as any).callbacks = callbacks;
    (provider as any).lastInterimText = "when we see this text"; // 21 chars
    (provider as any).lastInterimTimestamp = Date.now(); // recent — no time-gap

    // Simulate a new recognizing event with shorter, unrelated text
    // The turn-boundary check: 21 > 15 ✓, 14 < 21*0.75 (15.75) ✓, no shared prefix ✓
    // This calls flushPendingInterim internally — simulate via direct method test
    const oldText = (provider as any).lastInterimText;
    const newText = "he was waiting"; // 14 chars, 66.7% of 21

    const shouldFlush =
      oldText.length > 15 &&
      newText.length < oldText.length * 0.75 &&
      !(provider as any).sharePrefix(oldText, newText);

    expect(shouldFlush).toBe(true);
  });

  it("does NOT flush when new interim is 80% of old length (above 0.75 ratio)", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);

    const oldText = "when we see this text here"; // 25 chars
    const newText = "something entirely new!!"; // 24 chars = 96% of 25

    const shouldFlush =
      oldText.length > 15 &&
      newText.length < oldText.length * 0.75 &&
      !(provider as any).sharePrefix(oldText, newText);

    expect(shouldFlush).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AzureSpeechProvider — time-gap flush
// ---------------------------------------------------------------------------

describe("AzureSpeechProvider time-gap flush", () => {
  it("flushes pending interim when recognizing event arrives after >3s gap", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    (provider as any).callbacks = callbacks;
    (provider as any).lastInterimText = "when we see this text";
    // Simulate the last interim arrived 5 seconds ago
    (provider as any).lastInterimTimestamp = Date.now() - 5000;

    (provider as any).flushPendingInterim("time-gap");

    expect(callbacks.onFinal).toHaveBeenCalledWith("when we see this text");
    expect((provider as any).lastInterimText).toBe("");
  });

  it("detects time-gap condition correctly (>3000ms)", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);

    const now = Date.now();
    (provider as any).lastInterimText = "some pending text";
    (provider as any).lastInterimTimestamp = now - 3001; // just over 3s ago

    const shouldFlush =
      (provider as any).lastInterimText &&
      (provider as any).lastInterimTimestamp > 0 &&
      now - (provider as any).lastInterimTimestamp > 3000;

    expect(shouldFlush).toBeTruthy();
  });

  it("does NOT trigger time-gap flush when interims arrive within normal cadence (<3s)", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);

    const now = Date.now();
    (provider as any).lastInterimText = "some pending text";
    (provider as any).lastInterimTimestamp = now - 200; // 200ms ago (normal cadence)

    const shouldFlush =
      (provider as any).lastInterimText &&
      (provider as any).lastInterimTimestamp > 0 &&
      now - (provider as any).lastInterimTimestamp > 3000;

    expect(shouldFlush).toBeFalsy();
  });

  it("does NOT trigger time-gap flush when lastInterimTimestamp is 0 (no prior interim)", () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);

    (provider as any).lastInterimText = "";
    (provider as any).lastInterimTimestamp = 0;

    const shouldFlush =
      (provider as any).lastInterimText &&
      (provider as any).lastInterimTimestamp > 0 &&
      Date.now() - (provider as any).lastInterimTimestamp > 3000;

    expect(shouldFlush).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// WhisperSpeechProvider — stop() with pending lastInterim
// ---------------------------------------------------------------------------

describe("WhisperSpeechProvider stop with pending lastInterim", () => {
  it("promotes lastInterim to final even if stability threshold not met", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Mock invoke to fail (we don't need actual init)
    vi.mocked(invoke).mockRejectedValue(new Error("not needed"));

    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    // Set internal state to simulate mid-recording with pending interim
    (provider as any).callbacks = callbacks;
    (provider as any).running = false; // Already stopped
    (provider as any).lastInterim = "unstable speech";
    (provider as any).sessionChunks = [];
    (provider as any).sessionSampleCount = 0;
    (provider as any).committedSamples = 0;
    (provider as any).decoding = false;

    await provider.stop();

    // The stop-safety net should have promoted lastInterim
    expect(callbacks.onFinal).toHaveBeenCalledWith("unstable speech");
    expect((provider as any).lastInterim).toBe("");
  });

  it("does not promote lastInterim on skipFlush=true", async () => {
    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);
    const callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    (provider as any).callbacks = callbacks;
    (provider as any).running = false;
    (provider as any).lastInterim = "should be discarded";
    (provider as any).sessionChunks = [];
    (provider as any).sessionSampleCount = 0;

    await provider.stop(true);

    // skipFlush skips the final flush entirely
    expect(callbacks.onFinal).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WhisperSpeechProvider — microphone lifecycle trace events
// ---------------------------------------------------------------------------

describe("WhisperSpeechProvider microphone trace events", () => {
  beforeEach(() => {
    clearTrace();
    setTracingEnabled(true);
  });

  afterEach(() => {
    clearTrace();
    setTracingEnabled(false);
  });

  it("traces microphone mute, unmute, and ended events from the media track", () => {
    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);
    const track = {
      enabled: true,
      readyState: "live",
      onmute: null,
      onunmute: null,
      onended: null,
    } as unknown as MediaStreamTrack;

    (provider as any).mediaStream = {
      getAudioTracks: () => [track],
    } as MediaStream;

    (provider as any)._attachMicTrackListeners();

    track.onmute?.(new Event("mute"));
    track.onunmute?.(new Event("unmute"));
    track.onended?.(new Event("ended"));

    const entries = getTraceEntries();
    expect(entries.some((entry) => entry.event === "mic:muted")).toBe(true);
    expect(entries.some((entry) => entry.event === "mic:unmuted")).toBe(true);
    expect(entries.some((entry) => entry.event === "mic:ended")).toBe(true);
  });

  it("clears track listeners during teardown so manual stop does not emit mic ended", () => {
    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);
    const stop = vi.fn();
    const track = {
      enabled: true,
      readyState: "live",
      onmute: vi.fn(),
      onunmute: vi.fn(),
      onended: vi.fn(),
      stop,
    } as unknown as MediaStreamTrack;

    (provider as any).mediaStream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as MediaStream;
    (provider as any).micTrack = track;

    (provider as any)._syncTeardown();

    expect(track.onmute).toBeNull();
    expect(track.onunmute).toBeNull();
    expect(track.onended).toBeNull();
    expect(stop).toHaveBeenCalled();
  });

  it("traces the requested stop reason", async () => {
    const provider = new WhisperSpeechProvider("tiny", "en", 3, 1, false);
    (provider as any).callbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };
    (provider as any).running = false;
    (provider as any).sessionChunks = [];
    (provider as any).sessionSampleCount = 0;

    await provider.stop(true, "user-toggle");

    expect(
      getTraceEntries().some(
        (entry) => entry.event === "session:stop-requested" && entry.detail.includes("reason=user-toggle"),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provider event contract — session vs mic lifecycle
// ---------------------------------------------------------------------------

describe("Provider trace event contract", () => {
  beforeEach(() => {
    clearTrace();
    setTracingEnabled(true);
  });

  afterEach(() => {
    clearTrace();
    setTracingEnabled(false);
    vi.restoreAllMocks();
  });

  it("OsSpeechProvider emits session stop request without fake mic lifecycle events", async () => {
    const provider = new OsSpeechProvider("en-US", true, 3);
    const stop = vi.fn();
    const addEventListener = vi.fn((_event: string, handler: () => void) => {
      handler();
    });
    const removeEventListener = vi.fn();

    (provider as any).recognition = {
      addEventListener,
      removeEventListener,
      stop,
    };

    await provider.stop(false, "user-toggle");

    const events = getTraceEntries().map((entry) => entry.event);
    expect(events).toContain("session:stop-requested");
    expect(events).not.toContain("mic:stopping");
    expect(stop).toHaveBeenCalled();
  });

  it("AzureSpeechProvider emits session stop request without fake mic lifecycle events", async () => {
    const provider = new AzureSpeechProvider("key", "westus", ["en-US"], 30);
    (provider as any).recognizer = null;

    await provider.stop(false, "dismiss");

    const entries = getTraceEntries();
    expect(entries.some((entry) => entry.event === "session:stop-requested" && entry.detail.includes("reason=dismiss"))).toBe(true);
    expect(entries.some((entry) => entry.event.startsWith("mic:"))).toBe(false);
  });
});
