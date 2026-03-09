// ---------------------------------------------------------------------------
// Whisper (local) provider — rolling-window realtime
// ---------------------------------------------------------------------------

import { invoke } from "@tauri-apps/api/core";
import { WHISPER_SILENCE_RMS_THRESHOLD, WHISPER_STABILITY_COUNT } from "../constants";
import type { SpeechCallbacks, SpeechProvider } from "./types";
import { traceEvent } from "../speechTraceStore";
import {
  cleanText,
  stripOverlap,
  checkStability,
  buildSessionBuffer as buildBuffer,
  computeCompaction,
  computeRms,
  uint8ToBase64,
} from "./whisperHelpers";

// ---------------------------------------------------------------------------
// Cached AudioWorklet blob URL — reused across all WhisperSpeechProvider instances.
// ---------------------------------------------------------------------------
const WORKLET_CODE = `
  class PCMProcessor extends AudioWorkletProcessor {
    process(inputs) {
      const ch = inputs[0]?.[0];
      if (ch) this.port.postMessage(ch);
      return true;
    }
  }
  registerProcessor('pcm-processor', PCMProcessor);
`;
let cachedWorkletUrl: string | null = null;
function getWorkletUrl(): string {
  if (!cachedWorkletUrl) {
    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    cachedWorkletUrl = URL.createObjectURL(blob);
  }
  return cachedWorkletUrl;
}

/** Revoke the cached worklet Blob URL. Call during app teardown to release memory. */
export function revokeWorkletUrl(): void {
  if (cachedWorkletUrl) {
    URL.revokeObjectURL(cachedWorkletUrl);
    cachedWorkletUrl = null;
  }
}

// uint8ToBase64 imported from ./whisperHelpers

// ---------------------------------------------------------------------------
// WhisperSpeechProvider
// ---------------------------------------------------------------------------

export class WhisperSpeechProvider implements SpeechProvider {
  private callbacks: SpeechCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  /**
   * Incoming PCM chunks at 16 kHz. Kept as a list to avoid O(n) copying on
   * every incoming audio frame. Concatenated into a flat Float32Array only
   * when a decode window is needed.
   */
  private sessionChunks: Float32Array[] = [];
  private sessionSampleCount = 0;

  /** How many samples have already been committed as final text.
   *  The next decode window starts from `committedSamples - overlapSamples`. */
  private committedSamples = 0;

  private decodeTimer: ReturnType<typeof setInterval> | null = null;
  private firstDecodeTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /** Backpressure: true while a decode invoke is in-flight. */
  private decoding = false;
  /** When a tick fires during an in-flight decode, set this to request one more decode after. */
  private pendingDecode = false;

  /** Generation counter — results from older generations are silently dropped. */
  private generation = 0;

  /** Last interim text emitted — used for stability detection. */
  private lastInterim = "";
  /** How many consecutive decodes returned the same interim suffix. */
  private stabilityHits = 0;
  /** Last few words committed as final — used for overlap matching. */
  private lastCommittedWords: string[] = [];

  /** Number of overlap samples to retain for context. */
  private readonly overlapSamples: number;
  /** Decode cadence in ms. */
  private readonly decodeMs: number;
  /** Maximum session samples before forcing a commit (5 minutes at 16 kHz). */
  private readonly maxSessionSamples: number;

  /** Reusable flat buffer for session data — grows as needed to avoid
   *  allocating a new Float32Array on every decode cycle. */
  private sessionBuffer: Float32Array = new Float32Array(0);

  constructor(
    private modelName: string,
    private language: string,
    private decodeIntervalSeconds: number,
    private contextOverlapSeconds: number,
    private microphoneDeviceId?: string,
    private phraseList?: string[],
  ) {
    this.overlapSamples = Math.round(contextOverlapSeconds * 16000);
    this.decodeMs = Math.max(250, decodeIntervalSeconds * 1000);
    this.maxSessionSamples = 5 * 60 * 16000; // 5 minutes
  }

  start(callbacks: SpeechCallbacks): void {
    if (this.running) return;
    this.callbacks = callbacks;
    this.generation++;
    this._startAsync(callbacks).catch((err) => {
      this.running = false;
      callbacks.onError(String(err));
      callbacks.onStatusChange("error");
    });
  }

  private async _startAsync(callbacks: SpeechCallbacks): Promise<void> {
    // Ensure model is loaded
    await invoke("whisper_load_model", { modelName: this.modelName });

    this.running = true;

    // Open mic at 16 kHz
    const constraints: MediaStreamConstraints = {
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        ...(this.microphoneDeviceId ? { deviceId: { exact: this.microphoneDeviceId } } : {}),
      },
    };
    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

    try {
      this.audioContext = new AudioContext({ sampleRate: 16000 });

      // Use cached AudioWorklet for PCM capture
      await this.audioContext.audioWorklet.addModule(getWorkletUrl());

      this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
      this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!this.running) return;
        const incoming = e.data;
        this.sessionChunks.push(incoming);
        this.sessionSampleCount += incoming.length;

        // Prevent unbounded memory growth: if we've accumulated more than
        // maxSessionSamples without a commit, force a compact.
        if (this.sessionSampleCount - this.committedSamples > this.maxSessionSamples) {
          this._compactChunks();
        }

        // Compute RMS audio level from the incoming PCM chunk and report to UI.
        if (this.callbacks?.onAudioLevel) {
          let sumSq = 0;
          for (let i = 0; i < incoming.length; i++) sumSq += incoming[i] * incoming[i];
          const rms = Math.sqrt(sumSq / incoming.length);
          // Normalize: rms of ~0.15 ≈ moderate speech → map to ~1.0
          this.callbacks.onAudioLevel(Math.min(rms / 0.15, 1));
        }
      };

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination); // required for processing

      callbacks.onStatusChange("listening");
      traceEvent("info", "started", `Whisper started (model=${this.modelName}, lang=${this.language}, interval=${this.decodeIntervalSeconds}s)`);

      // Fire an eager first decode after 500 ms so the user sees text quickly,
      // then switch to the regular cadence.
      const firstDecodeDelay = Math.min(500, this.decodeMs);
      this.firstDecodeTimer = setTimeout(() => {
        this.firstDecodeTimer = null;
        if (!this.running) return;
        this._tickDecode();
        // Now start the steady-state interval
        if (this.running && !this.decodeTimer) {
          this.decodeTimer = setInterval(() => {
            this._tickDecode();
          }, this.decodeMs);
        }
      }, firstDecodeDelay);
    } catch (err) {
      // Clean up media stream on failure to prevent mic leak
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((t) => t.stop());
        this.mediaStream = null;
      }
      if (this.audioContext) {
        try { this.audioContext.close(); } catch { /* ignore */ }
        this.audioContext = null;
      }
      throw err;
    }
  }

  // ----- decode pipeline -----

  private _tickDecode(): void {
    if (!this.running) return;
    if (this.decoding) {
      // Another decode in-flight — just mark that we want one more after it finishes.
      this.pendingDecode = true;
      return;
    }
    // Use .catch() so any unexpected rejection surfaces as an error callback
    // rather than an unhandled Promise rejection that could silence the bug.
    this._runDecode().catch((err) => {
      this.decoding = false;
      this.callbacks?.onError(`Decode error: ${err}`);
    });
  }

  private async _runDecode(): Promise<void> {
    if (!this.running || !this.callbacks) return;

    // Determine the window to decode: from (committedSamples - overlap) to end of buffer.
    const windowStart = Math.max(0, this.committedSamples - this.overlapSamples);
    const windowEnd = this.sessionSampleCount;
    if (windowEnd - windowStart < 1600) return; // < 0.1s of audio, skip

    // Only check silence on the NEW audio portion (after committedSamples).
    // The overlap region always contains old speech and would falsely pass the RMS check.
    const newAudioStart = this.committedSamples;
    if (windowEnd <= newAudioStart) return; // no new audio beyond what's committed
    if (windowEnd - newAudioStart < 800) return; // < 50ms of new audio, skip

    // Build the flat buffer once per decode cycle — not on every audio chunk.
    const sessionBuffer = this._buildSessionBuffer();

    const newSamples = sessionBuffer.subarray(newAudioStart, windowEnd);
    const rms = computeRms(newSamples);
    if (rms < WHISPER_SILENCE_RMS_THRESHOLD) return;

    const samples = sessionBuffer.slice(windowStart, windowEnd);

    // Notify UI that a new decode cycle is starting.
    this.callbacks.onDecodeStart?.();

    // Encode float32 PCM to base64
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const audioB64 = uint8ToBase64(bytes);

    const initialPrompt =
      this.phraseList && this.phraseList.length > 0
        ? this.phraseList.join(", ")
        : undefined;

    this.decoding = true;
    const gen = this.generation;
    const t0 = performance.now();

    try {
      const fullText = await invoke<string>("whisper_transcribe", {
        audioB64,
        sampleRate: 16000,
        language: this.language,
        initialPrompt,
      });

      // Report decode latency to UI.
      if (gen === this.generation && this.running) {
        const latency = performance.now() - t0;
        this.callbacks?.onDecodeLatency?.(latency);
        traceEvent("event", "decode", `latency=${Math.round(latency)}ms, window=${Math.round((windowEnd - windowStart) / 16000 * 10) / 10}s, result=${fullText ? fullText.length : 0} chars`);
      }

      // Drop result if generation changed (user stopped / restarted).
      if (gen !== this.generation || !this.running) return;

      if (fullText) {
        this._reconcile(fullText, windowEnd);
      }
    } catch (err) {
      if (gen === this.generation && this.running) {
        this.callbacks?.onError(`Whisper transcription error: ${err}`);
      }
    } finally {
      this.decoding = false;
      // If a tick fired while we were busy, schedule one more decode.
      // Use queueMicrotask to break the call stack and prevent unbounded recursion.
      if (this.pendingDecode && this.running) {
        this.pendingDecode = false;
        queueMicrotask(() => this._runDecode());
      }
    }
  }

  // ----- overlap reconciliation -----

  private _clean(text: string): string {
    return cleanText(text);
  }

  /**
   * Given the full text Whisper returned for the current rolling window,
   * separate it into already-committed (overlap region) and new content.
   *
   * Strategy: match `lastCommittedWords` at the start of the new transcription
   * to find where the overlap ends. This is robust to pauses and bursty speech
   * (unlike the old word-fraction heuristic).
   */
  private _reconcile(windowText: string, windowEndSample: number): void {
    if (!this.callbacks) return;

    const newText = stripOverlap(this.lastCommittedWords, windowText);
    if (!newText) {
      // Either empty input or all words matched committed text.
      if (this.lastCommittedWords.length > 0 && cleanText(windowText)) {
        this.callbacks.onInterim("");
      }
      return;
    }

    this._emitInterimOrCommit(newText, windowEndSample);
  }

  /**
   * Emit text as interim. If the same text appears across multiple consecutive
   * decode cycles (stability), commit it as final.
   */
  private _emitInterimOrCommit(text: string, windowEndSample: number): void {
    if (!this.callbacks) return;

    const result = checkStability(text, this.lastInterim, this.stabilityHits, WHISPER_STABILITY_COUNT);
    this.lastInterim = result.newLastInterim;
    this.stabilityHits = result.newStabilityHits;

    if (result.shouldCommit) {
      traceEvent("data", "recognized", `final (${text.length} chars, stability=${WHISPER_STABILITY_COUNT}): ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`);
      this.callbacks.onFinal(text);
      this.callbacks.onInterim?.("");
      this.committedSamples = windowEndSample;
      this.lastCommittedWords = text.split(/\s+/).slice(-10);
      this.lastInterim = "";
      this.stabilityHits = 0;
      this._compactChunks();
    } else {
      traceEvent("event", "recognizing", `interim (${text.length} chars, hits=${result.newStabilityHits}/${WHISPER_STABILITY_COUNT}): ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
      this.callbacks.onInterim(text);
    }
  }

  // ----- lifecycle -----

  async stop(skipFlush = false): Promise<void> {
    this.running = false;
    if (this.decodeTimer) {
      clearInterval(this.decodeTimer);
      this.decodeTimer = null;
    }
    this.generation++; // invalidate stale pending results

    if (skipFlush) {
      // Fast path for restart: don't wait for in-flight decode or flush.
      // The generation bump ensures any in-flight decode result is discarded.
      await this._cleanup();
      this.callbacks?.onStatusChange("idle");
      return;
    }

    // Normal stop: wait for any in-flight decode to finish so we don't
    // contend on the Whisper Mutex during the final flush.
    if (this.decoding) {
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 5000; // 5s timeout
        const check = () => {
          if (!this.decoding || Date.now() >= deadline) return resolve();
          setTimeout(check, 10);
        };
        check();
      });
    }

    // Time-box the final flush to 500 ms.
    await Promise.race([
      this._flushFinal(),
      new Promise<void>((r) => setTimeout(r, 500)),
    ]);

    await this._cleanup();
    this.callbacks?.onStatusChange("idle");
  }

  /** Flush whatever is in the session buffer as a final transcription. */
  private async _flushFinal(): Promise<void> {
    if (!this.callbacks) return;
    const start = Math.max(0, this.committedSamples - this.overlapSamples);
    if (this.sessionSampleCount - start < 1600) return;

    const sessionBuffer = this._buildSessionBuffer();
    const samples = sessionBuffer.slice(start);
    if (computeRms(samples) < WHISPER_SILENCE_RMS_THRESHOLD) return;

    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    const audioB64 = uint8ToBase64(bytes);

    const initialPrompt =
      this.phraseList && this.phraseList.length > 0 ? this.phraseList.join(", ") : undefined;

    try {
      const text = await invoke<string>("whisper_transcribe", {
        audioB64,
        sampleRate: 16000,
        language: this.language,
        initialPrompt,
      });
      const cleaned = text ? this._clean(text) : "";
      if (cleaned) {
        const newText = stripOverlap(this.lastCommittedWords, cleaned);
        if (newText) {
          traceEvent("data", "flush-final", `final flush (${newText.length} chars): ${newText.slice(0, 120)}${newText.length > 120 ? "…" : ""}`);
          this.callbacks.onFinal(newText);
          this.callbacks.onInterim?.("");
        }
      }
    } catch {
      // Swallow errors on final flush — we're stopping anyway.
    }
  }

  dispose(): void {
    this.running = false;
    this.generation++;
    if (this.firstDecodeTimer !== null) {
      clearTimeout(this.firstDecodeTimer);
      this.firstDecodeTimer = null;
    }
    if (this.decodeTimer) {
      clearInterval(this.decodeTimer);
      this.decodeTimer = null;
    }
    // Synchronous teardown: disconnect nodes and stop tracks immediately
    // to release hardware resources without waiting for async AudioContext close.
    this._syncTeardown();
    // Fire-and-forget the async AudioContext close
    this._closeAudioContext();
    this.callbacks = null;
  }

  /** Synchronous resource release — disconnects nodes, stops tracks, resets state. */
  private _syncTeardown(): void {
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.sessionChunks = [];
    this.sessionSampleCount = 0;
    this.committedSamples = 0;
    this.sessionBuffer = new Float32Array(0);
    this.lastInterim = "";
    this.lastCommittedWords = [];
    this.stabilityHits = 0;
    this.decoding = false;
    this.pendingDecode = false;
  }

  /** Async AudioContext close — fire-and-forget safe. */
  private async _closeAudioContext(): Promise<void> {
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch { /* already closed */ }
      this.audioContext = null;
    }
  }

  /**
   * Concatenate all accumulated session chunks into a flat Float32Array.
   * Reuses an internal buffer that grows as needed to avoid repeated large
   * allocations during long recording sessions.
   * Call only at decode time — not on every incoming audio frame.
   */
  private _buildSessionBuffer(): Float32Array {
    const result = buildBuffer(this.sessionChunks, this.sessionSampleCount, this.sessionBuffer);
    if (result !== this.sessionBuffer && this.sessionChunks.length > 1) {
      this.sessionBuffer = result;
    }
    return result;
  }

  /**
   * Discard audio chunks before the overlap window to bound memory growth
   * during long recording sessions. Called after each commit.
   */
  private _compactChunks(): void {
    const { dropCount, dropSamples } = computeCompaction(
      this.sessionChunks, this.committedSamples, this.overlapSamples,
    );
    if (dropCount > 0) {
      this.sessionChunks.splice(0, dropCount);
      this.sessionSampleCount -= dropSamples;
      this.committedSamples -= dropSamples;
    }
  }

  private async _cleanup(): Promise<void> {
    this._syncTeardown();
    await this._closeAudioContext();
  }
}
