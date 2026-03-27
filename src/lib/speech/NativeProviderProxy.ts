// ---------------------------------------------------------------------------
// NativeProviderProxy — TypeScript SpeechProvider bridge for Rust-native
// speech providers.
//
// For providers whose recognition engine runs on the Rust/OS side (e.g.
// Apple SFSpeechRecognizer, Windows SpeechContinuousRecognitionSession),
// this class acts as the SpeechProvider implementation in the WebView.
// It forwards start/stop commands via invoke() and subscribes to Tauri
// events emitted by the Rust `SpeechEmitter`.
//
// Plugin developers do NOT need to write custom bridging code — they
// return `new NativeProviderProxy(id, config)` from their plugin's
// `createProvider()` method and implement the Rust `NativeSpeechProvider`
// trait on the backend.
// ---------------------------------------------------------------------------

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SpeechProvider, SpeechCallbacks } from "./types";

export class NativeProviderProxy implements SpeechProvider {
  private listeners: Promise<UnlistenFn>[] = [];
  private started = false;

  /**
   * @param providerId Must match the Rust-side `NativeSpeechProvider::id()`.
   * @param config  Provider config passed to the Rust `start()` method.
   */
  constructor(
    private readonly providerId: string,
    private readonly config: Record<string, unknown>,
  ) {}

  start(callbacks: SpeechCallbacks): void {
    const id = this.providerId;

    // Subscribe to all events from the native provider.
    // Each listener maps a Rust SpeechEmitter event to a SpeechCallbacks call.
    this.listeners = [
      listen<{ text: string }>(`speech://${id}/interim`, (e) => {
        callbacks.onInterim(e.payload.text);
      }),
      listen<{ text: string }>(`speech://${id}/final`, (e) => {
        callbacks.onFinal(e.payload.text);
      }),
      listen<{ message: string }>(`speech://${id}/error`, (e) => {
        callbacks.onError(e.payload.message);
      }),
      listen<{ status: string }>(`speech://${id}/status`, (e) => {
        callbacks.onStatusChange(e.payload.status as "idle" | "listening" | "error");
      }),
    ];

    // Optional capability-based events — only fire if the callback exists
    if (callbacks.onAudioLevel) {
      this.listeners.push(
        listen<{ level: number }>(`speech://${id}/audio-level`, (e) => {
          callbacks.onAudioLevel!(e.payload.level);
        }),
      );
    }

    if (callbacks.onDecodeStart) {
      this.listeners.push(
        listen<Record<string, never>>(`speech://${id}/decode-start`, (e) => {
          callbacks.onDecodeStart!();
        }),
      );
    }

    if (callbacks.onDecodeLatency) {
      this.listeners.push(
        listen<{ ms: number }>(`speech://${id}/decode-latency`, (e) => {
          callbacks.onDecodeLatency!(e.payload.ms);
        }),
      );
    }

    if (callbacks.onPerformanceUpdate) {
      this.listeners.push(
        listen<{ rtf: number; avgRtf: number; inferenceMs: number; backend?: string }>(
          `speech://${id}/performance`,
          (e) => {
            callbacks.onPerformanceUpdate!(e.payload);
          },
        ),
      );
    }

    // Tell the Rust provider to start
    this.started = true;
    invoke("native_speech_start", {
      providerId: id,
      config: this.config,
    }).catch((err) => {
      callbacks.onError(`Failed to start native provider: ${err}`);
    });
  }

  async stop(_skipFlush?: boolean, _reason?: string): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await invoke("native_speech_stop", { providerId: this.providerId });
    await this.removeListeners();
  }

  dispose(): void {
    this.started = false;
    this.removeListeners();
  }

  private async removeListeners(): Promise<void> {
    const listeners = this.listeners;
    this.listeners = [];
    for (const listenerPromise of listeners) {
      try {
        const unlisten = await listenerPromise;
        unlisten();
      } catch {
        // Listener may have already been cleaned up
      }
    }
  }
}
