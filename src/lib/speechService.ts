import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./settingsStore";
import { WHISPER_SILENCE_RMS_THRESHOLD } from "./constants";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface SpeechCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "idle" | "listening" | "error") => void;
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
  stop(): Promise<void>;
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
// Whisper (local) provider
// ---------------------------------------------------------------------------

export class WhisperSpeechProvider implements SpeechProvider {
  private callbacks: SpeechCallbacks | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private pcmBuffer: Float32Array = new Float32Array(0);
  private chunkTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private modelName: string,
    private language: string,
    private chunkSeconds: number,
    private microphoneDeviceId?: string,
    private phraseList?: string[],
  ) {}

  start(callbacks: SpeechCallbacks): void {
    this.callbacks = callbacks;
    this.running = true;
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

    // Use AudioWorklet for PCM capture
    const workletCode = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (ch) this.port.postMessage(ch);
          return true;
        }
      }
      registerProcessor('pcm-processor', PCMProcessor);
    `;
    const blob = new Blob([workletCode], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
    this.workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.running) return;
      const incoming = e.data;
      const merged = new Float32Array(this.pcmBuffer.length + incoming.length);
      merged.set(this.pcmBuffer);
      merged.set(incoming, this.pcmBuffer.length);
      this.pcmBuffer = merged;
    };

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.audioContext.destination); // required for processing

    callbacks.onStatusChange("listening");

    // Periodically flush buffer and transcribe
    const chunkMs = this.chunkSeconds * 1000;
    this.chunkTimer = setInterval(() => {
      this._flushAndTranscribe();
    }, chunkMs);
  }

  private async _flushAndTranscribe(): Promise<void> {
    if (!this.running || !this.callbacks) return;
    if (this.pcmBuffer.length === 0) return;

    const samples = this.pcmBuffer;
    this.pcmBuffer = new Float32Array(0);

    // Skip silent chunks — compute RMS energy and discard if below threshold.
    // This prevents Whisper from hallucinating phrase-list text on silence.
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      sumSq += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sumSq / samples.length);
    if (rms < WHISPER_SILENCE_RMS_THRESHOLD) return; // ~-40 dB, effectively silence

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

    try {
      const text = await invoke<string>("whisper_transcribe", {
        audioB64,
        sampleRate: 16000,
        language: this.language,
        initialPrompt,
      });
      if (text && this.running) {
        this.callbacks.onFinal(text);
      }
    } catch (err) {
      if (this.running) {
        this.callbacks?.onError(`Whisper transcription error: ${err}`);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
    // Transcribe any remaining audio
    await this._flushAndTranscribe();
    this._cleanup();
    this.callbacks?.onStatusChange("idle");
  }

  dispose(): void {
    this.running = false;
    if (this.chunkTimer) {
      clearInterval(this.chunkTimer);
      this.chunkTimer = null;
    }
    this._cleanup();
    this.callbacks = null;
  }

  private _cleanup(): void {
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    this.pcmBuffer = new Float32Array(0);
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
      settings.whisper_chunk_seconds,
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
