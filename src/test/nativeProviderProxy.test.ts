import { describe, it, expect, vi, beforeEach } from "vitest";
import { NativeProviderProxy } from "../lib/speech/NativeProviderProxy";
import type { SpeechCallbacks } from "../lib/speech/types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

describe("NativeProviderProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure invoke returns a resolved Promise (NativeProviderProxy chains .catch on it)
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });
  it("implements the SpeechProvider interface", () => {
    const proxy = new NativeProviderProxy("test-provider", { language: "en-US" });
    expect(typeof proxy.start).toBe("function");
    expect(typeof proxy.stop).toBe("function");
    expect(typeof proxy.dispose).toBe("function");
  });

  it("calls invoke with correct args on start", () => {
    const proxy = new NativeProviderProxy("apple", { language: "de-DE" });
    const callbacks: SpeechCallbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    proxy.start(callbacks);

    expect(invoke).toHaveBeenCalledWith("native_speech_start", {
      providerId: "apple",
      config: { language: "de-DE" },
    });
  });

  it("subscribes to Tauri events for the provider ID", () => {
    const proxy = new NativeProviderProxy("apple", {});
    const callbacks: SpeechCallbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    proxy.start(callbacks);

    // Should have subscribed to at least interim, final, error, status events
    const listenCalls = (listen as ReturnType<typeof vi.fn>).mock.calls;
    const eventNames = listenCalls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain("speech://apple/interim");
    expect(eventNames).toContain("speech://apple/final");
    expect(eventNames).toContain("speech://apple/error");
    expect(eventNames).toContain("speech://apple/status");
  });

  it("calls invoke with correct args on stop", async () => {
    const proxy = new NativeProviderProxy("apple", {});
    const callbacks: SpeechCallbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
    };

    proxy.start(callbacks);
    await proxy.stop();

    expect(invoke).toHaveBeenCalledWith("native_speech_stop", {
      providerId: "apple",
    });
  });

  it("subscribes to optional audio-level event when callback provided", () => {
    const proxy = new NativeProviderProxy("apple", {});
    const callbacks: SpeechCallbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
      onAudioLevel: vi.fn(),
    };

    proxy.start(callbacks);

    const listenCalls = (listen as ReturnType<typeof vi.fn>).mock.calls;
    const eventNames = listenCalls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain("speech://apple/audio-level");
  });

  it("does not subscribe to optional events when callback not provided", () => {
    const proxy = new NativeProviderProxy("apple", {});
    const callbacks: SpeechCallbacks = {
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
      // No optional callbacks
    };

    proxy.start(callbacks);

    const listenCalls = (listen as ReturnType<typeof vi.fn>).mock.calls;
    const eventNames = listenCalls.map((c: unknown[]) => c[0]);
    expect(eventNames).not.toContain("speech://apple/audio-level");
    expect(eventNames).not.toContain("speech://apple/decode-latency");
    expect(eventNames).not.toContain("speech://apple/performance");
  });
});
