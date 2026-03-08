import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./settingsStore";
import { WHISPER_SILENCE_RMS_THRESHOLD, WHISPER_STABILITY_COUNT } from "./constants";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SpeechCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "idle" | "listening" | "error") => void;
  /** Called by the Whisper provider each time a new decode cycle starts. */
  onDecodeStart?: () => void;
  /** Called after each Whisper decode with the wall-clock latency in milliseconds. */
  onDecodeLatency?: (ms: number) => void;
  /** Called with a normalized 0–1 audio level (Whisper provider only). */
  onAudioLevel?: (level: number) => void;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface EnumerateResult {
  devices: AudioDevice[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface SpeechProvider {
  start(callbacks: SpeechCallbacks): void;
  stop(skipFlush?: boolean): Promise<void>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Web Speech API availability detection
// ---------------------------------------------------------------------------

const SpeechRecognitionCtor: typeof SpeechRecognition | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export function detectWebSpeechAvailability(): boolean {
  return SpeechRecognitionCtor !== undefined;
}

export const webSpeechAvailable: boolean = detectWebSpeechAvailability();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export async function checkMicrophonePermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state;
  } catch {
    return "unknown";
  }
}

export async function enumerateAudioDevices(): Promise<EnumerateResult> {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      devices: devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` })),
    };
  } catch (e) {
    const err = e instanceof DOMException ? e : null;
    if (err?.name === "NotAllowedError") {
      return { devices: [], error: "Microphone access was denied. Please allow microphone access in your system settings." };
    }
    if (err?.name === "NotFoundError") {
      return { devices: [], error: "No microphone found. Please connect a microphone and try again." };
    }
    return { devices: [], error: "Could not access microphone. Please check your audio device and permissions." };
  }
}

export async function testAzureConnection(
  key: string,
  region: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!key || !region) {
    return { ok: false, error: "Speech key and region are required." };
  }
  try {
    const resp = await fetch(
      `https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Length": "0",
        },
      },
    );
    if (resp.ok) return { ok: true };
    if (resp.status === 401) return { ok: false, error: "Invalid API key." };
    if (resp.status === 403) return { ok: false, error: "API key is not authorized for this region." };
    return { ok: false, error: `Azure returned status ${resp.status}.` };
  } catch {
    return { ok: false, error: "Could not reach Azure. Check your internet connection and region." };
  }
}

// ---------------------------------------------------------------------------
// OS (Web Speech API) provider
// ---------------------------------------------------------------------------

export class OsSpeechProvider implements SpeechProvider {
  private recognition: SpeechRecognition | null = null;
  private callbacks: SpeechCallbacks | null = null;
  private restartCount = 0;
  private intentionallyStopped = false;

  constructor(
    private language: string,
    private autoRestart: boolean,
    private maxRestarts: number,
  ) {}

  start(callbacks: SpeechCallbacks): void {
    if (!SpeechRecognitionCtor) {
      callbacks.onError("Web Speech API is not available in this browser.");
      callbacks.onStatusChange("error");
      return;
    }

    this.callbacks = callbacks;
    this.intentionallyStopped = false;
    this.restartCount = 0;

    const rec = new SpeechRecognitionCtor();
    rec.lang = this.language;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          callbacks.onFinal(result[0].transcript);
        } else {
          callbacks.onInterim(result[0].transcript);
        }
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "aborted" && this.intentionallyStopped) return;
      if (e.error === "no-speech") return; // silent — not a real error
      callbacks.onError(`Speech recognition error: ${e.error}`);
      callbacks.onStatusChange("error");
    };

    rec.onend = () => {
      if (this.intentionallyStopped) {
        callbacks.onStatusChange("idle");
        return;
      }
      // Auto-restart logic
      if (this.autoRestart && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        try {
          rec.start();
        } catch {
          callbacks.onStatusChange("idle");
        }
        return;
      }
      callbacks.onStatusChange("idle");
    };

    this.recognition = rec;
    try {
      rec.start();
      callbacks.onStatusChange("listening");
    } catch (err) {
      callbacks.onError(String(err));
      callbacks.onStatusChange("error");
    }
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.intentionallyStopped = true;
      if (this.recognition) {
        const onEnd = () => {
          this.recognition?.removeEventListener("end", onEnd);
          resolve();
        };
        this.recognition.addEventListener("end", onEnd);
        this.recognition.stop();
      } else {
        resolve();
      }
    });
  }

  dispose(): void {
    this.intentionallyStopped = true;
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }
    this.callbacks = null;
  }
}

// ---------------------------------------------------------------------------
// Azure Speech provider
// ---------------------------------------------------------------------------

export class AzureSpeechProvider implements SpeechProvider {
  private recognizer: sdk.SpeechRecognizer | null = null;

  constructor(
    private key: string,
    private region: string,
    private languages: string[],
    private microphoneDeviceId?: string,
    private phraseList?: string[],
    private autoPunctuation?: boolean,
  ) {}

  start(callbacks: SpeechCallbacks): void {
    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);

    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "15000");
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "5000");

    if (!this.autoPunctuation) {
      speechConfig.setProperty("postprocessingoption", "0");
    }

    const audioConfig = this.microphoneDeviceId
      ? sdk.AudioConfig.fromMicrophoneInput(this.microphoneDeviceId)
      : sdk.AudioConfig.fromDefaultMicrophoneInput();

    let rec: sdk.SpeechRecognizer;

    if (this.languages.length > 1) {
      const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(this.languages);
      rec = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);
    } else {
      speechConfig.speechRecognitionLanguage = this.languages[0] || "en-US";
      rec = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    }

    if (this.phraseList && this.phraseList.length > 0) {
      const grammar = sdk.PhraseListGrammar.fromRecognizer(rec);
      for (const phrase of this.phraseList) {
        grammar.addPhrase(phrase);
      }
    }

    this.recognizer = rec;

    rec.recognizing = (_s, e) => callbacks.onInterim(e.result.text);
    rec.recognized = (_s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        callbacks.onFinal(e.result.text);
      }
    };
    rec.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        callbacks.onError(e.errorDetails || "Recognition error");
        callbacks.onStatusChange("error");
      }
    };
    rec.sessionStopped = () => callbacks.onStatusChange("idle");

    rec.startContinuousRecognitionAsync(
      () => callbacks.onStatusChange("listening"),
      (err) => {
        callbacks.onError(String(err));
        callbacks.onStatusChange("error");
      },
    );
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.recognizer) {
        this.recognizer.stopContinuousRecognitionAsync(() => resolve(), () => resolve());
      } else {
        resolve();
      }
    });
  }

  dispose(): void {
    if (this.recognizer) {
      this.recognizer.close();
      this.recognizer = null;
    }
  }
}

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

// ---------------------------------------------------------------------------
// Whisper (local) provider — rolling-window realtime
// ---------------------------------------------------------------------------

export class WhisperSpeechProvider implements SpeechProvider {
  private callbacks: SpeechCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  /** Continuously growing session PCM buffer at 16 kHz. */
  private sessionBuffer: Float32Array = new Float32Array(0);

  /** How many samples have already been committed as final text.
   *  The next decode window starts from `committedSamples - overlapSamples`. */
  private committedSamples = 0;

  private decodeTimer: ReturnType<typeof setInterval> | null = null;
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
  }

  start(callbacks: SpeechCallbacks): void {
    this.callbacks = callbacks;
    this.running = true;
    this.generation++;
    this._startAsync(callbacks).catch((err) => {
      callbacks.onError(String(err));
      callbacks.onStatusChange("error");
    });
  }

  private async _startAsync(callbacks: SpeechCallbacks): Promise<void> {
    // Ensure model is loaded
    await invoke("whisper_load_model", { modelName: this.modelName });

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
    this.audioContext = new AudioContext({ sampleRate: 16000 });

    // Use cached AudioWorklet for PCM capture
    await this.audioContext.audioWorklet.addModule(getWorkletUrl());

    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.running) return;
      const incoming = e.data;
      const merged = new Float32Array(this.sessionBuffer.length + incoming.length);
      merged.set(this.sessionBuffer);
      merged.set(incoming, this.sessionBuffer.length);
      this.sessionBuffer = merged;

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

    // Fire an eager first decode after 500 ms so the user sees text quickly,
    // then switch to the regular cadence.
    const firstDecodeDelay = Math.min(500, this.decodeMs);
    setTimeout(() => {
      if (!this.running) return;
      this._tickDecode();
      // Now start the steady-state interval
      if (this.running && !this.decodeTimer) {
        this.decodeTimer = setInterval(() => {
          this._tickDecode();
        }, this.decodeMs);
      }
    }, firstDecodeDelay);
  }

  // ----- decode pipeline -----

  private _tickDecode(): void {
    if (!this.running) return;
    if (this.decoding) {
      // Another decode in-flight — just mark that we want one more after it finishes.
      this.pendingDecode = true;
      return;
    }
    this._runDecode();
  }

  private async _runDecode(): Promise<void> {
    if (!this.running || !this.callbacks) return;

    // Determine the window to decode: from (committedSamples - overlap) to end of buffer.
    const windowStart = Math.max(0, this.committedSamples - this.overlapSamples);
    const windowEnd = this.sessionBuffer.length;
    if (windowEnd - windowStart < 1600) return; // < 0.1s of audio, skip

    // Only check silence on the NEW audio portion (after committedSamples).
    // The overlap region always contains old speech and would falsely pass the RMS check.
    const newAudioStart = this.committedSamples;
    if (windowEnd > newAudioStart) {
      const newSamples = this.sessionBuffer.slice(newAudioStart, windowEnd);
      if (newSamples.length < 800) return; // < 50ms of new audio, skip
      let sumSq = 0;
      for (let i = 0; i < newSamples.length; i++) {
        sumSq += newSamples[i] * newSamples[i];
      }
      const rms = Math.sqrt(sumSq / newSamples.length);
      if (rms < WHISPER_SILENCE_RMS_THRESHOLD) return;
    } else {
      return; // no new audio beyond what's committed
    }

    const samples = this.sessionBuffer.slice(windowStart, windowEnd);

    // Notify UI that a new decode cycle is starting.
    this.callbacks.onDecodeStart?.();

    // Encode float32 PCM to base64
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const audioB64 = btoa(binary);

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
        this.callbacks?.onDecodeLatency?.(performance.now() - t0);
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
      // If a tick fired while we were busy, run one more decode now.
      if (this.pendingDecode && this.running) {
        this.pendingDecode = false;
        this._runDecode();
      }
    }
  }

  // ----- overlap reconciliation -----

  /** Whisper hallucination tokens to strip from results. */
  private static readonly HALLUCINATION_RE =
    /\[BLANK_AUDIO\]|\[MUSIC\]|\[SILENCE\]|\(silence\)|\(blank audio\)/gi;

  /** Strip hallucination tokens and collapse whitespace. */
  private _clean(text: string): string {
    return text.replace(WhisperSpeechProvider.HALLUCINATION_RE, " ").replace(/\s+/g, " ").trim();
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

    const trimmed = this._clean(windowText);
    if (!trimmed) return;

    // If nothing was committed yet, everything is new.
    if (this.lastCommittedWords.length === 0) {
      this._emitInterimOrCommit(trimmed, windowEndSample);
      return;
    }

    // Try to find lastCommittedWords at the beginning of the new transcription.
    // We look for the longest suffix of lastCommittedWords that matches a prefix
    // of the new text (case-insensitive), then take everything after it.
    const words = trimmed.split(/\s+/);
    const committed = this.lastCommittedWords;

    let bestMatchLen = 0; // how many words from `committed` matched at the start of `words`

    // Try matching the full committed phrase, then progressively shorter suffixes.
    // e.g., committed=["hello","world"], try matching "hello world" then just "world".
    for (let startIdx = 0; startIdx < committed.length; startIdx++) {
      const suffix = committed.slice(startIdx);
      if (suffix.length > words.length) continue;

      let match = true;
      for (let j = 0; j < suffix.length; j++) {
        if (suffix[j].toLowerCase() !== words[j].toLowerCase()) {
          match = false;
          break;
        }
      }
      if (match) {
        bestMatchLen = suffix.length;
        break; // longest matching suffix wins
      }
    }

    const newWords = words.slice(bestMatchLen);

    if (newWords.length === 0) {
      // All words matched committed text — nothing truly new.
      // Clear interim so we don't duplicate the already-committed final text.
      this.callbacks.onInterim("");
      return;
    }

    const newText = newWords.join(" ");
    this._emitInterimOrCommit(newText, windowEndSample);
  }

  /**
   * Emit text as interim. If the same text appears across multiple consecutive
   * decode cycles (stability), commit it as final.
   */
  private _emitInterimOrCommit(text: string, windowEndSample: number): void {
    if (!this.callbacks) return;

    if (text === this.lastInterim) {
      this.stabilityHits++;
    } else {
      this.lastInterim = text;
      this.stabilityHits = 1;
    }

    if (this.stabilityHits >= WHISPER_STABILITY_COUNT) {
      // Stable — commit as final.
      this.callbacks.onFinal(text);
      this.callbacks.onInterim?.("");
      this.committedSamples = windowEndSample;
      // Remember committed words for overlap matching in next decode.
      this.lastCommittedWords = text.split(/\s+/).slice(-10); // keep last 10 words
      this.lastInterim = "";
      this.stabilityHits = 0;
    } else {
      // Still changing — show as interim.
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
        const check = () => {
          if (!this.decoding) return resolve();
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
    if (this.sessionBuffer.length - start < 1600) return;

    const samples = this.sessionBuffer.slice(start);
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / samples.length);
    if (rms < WHISPER_SILENCE_RMS_THRESHOLD) return;

    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const audioB64 = btoa(binary);

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
        // Match committed words at the start and strip them.
        const words = cleaned.split(/\s+/);
        const committed = this.lastCommittedWords;
        let bestMatchLen = 0;
        for (let startIdx = 0; startIdx < committed.length; startIdx++) {
          const suffix = committed.slice(startIdx);
          if (suffix.length > words.length) continue;
          let match = true;
          for (let j = 0; j < suffix.length; j++) {
            if (suffix[j].toLowerCase() !== words[j].toLowerCase()) { match = false; break; }
          }
          if (match) { bestMatchLen = suffix.length; break; }
        }
        const newWords = words.slice(bestMatchLen);
        const newText = newWords.length > 0 ? newWords.join(" ") : cleaned;

        if (newText) {
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
    this.sessionBuffer = new Float32Array(0);
    this.committedSamples = 0;
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

  private async _cleanup(): Promise<void> {
    this._syncTeardown();
    await this._closeAudioContext();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSpeechProvider(settings: AppSettings): SpeechProvider {
  if (settings.speech_provider === "azure") {
    return new AzureSpeechProvider(
      settings.azure_speech_key,
      settings.azure_region,
      settings.languages,
      settings.microphone_device_id || undefined,
      settings.phrase_list.length > 0 ? settings.phrase_list : undefined,
      settings.auto_punctuation,
    );
  }
  if (settings.speech_provider === "whisper") {
    return new WhisperSpeechProvider(
      settings.whisper_model,
      settings.whisper_language,
      settings.whisper_decode_interval,
      settings.whisper_context_overlap,
      settings.microphone_device_id || undefined,
      settings.phrase_list.length > 0 ? settings.phrase_list : undefined,
    );
  }
  return new OsSpeechProvider(
    settings.os_language,
    settings.os_auto_restart,
    settings.os_max_restarts,
  );
}
