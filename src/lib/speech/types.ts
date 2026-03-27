// ---------------------------------------------------------------------------
// Shared types for speech providers
// ---------------------------------------------------------------------------

export interface SpeechCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "idle" | "listening" | "error") => void;
  /** Fired by providers with the `realtime-metrics` capability when a new decode cycle starts. */
  onDecodeStart?: () => void;
  /** Fired by providers with the `realtime-metrics` capability with decode wall-clock latency in ms. */
  onDecodeLatency?: (ms: number) => void;
  /** Fired by providers with the `audio-level` capability with a normalized 0–1 audio level. */
  onAudioLevel?: (level: number) => void;
  /**
   * Fired by providers with the `realtime-metrics` capability after each decode.
   * `rtf` = Real-Time Factor (inference_time / audio_duration). < 1.0 = real-time capable.
   * `backend` = "CUDA" | "Metal" | "CPU" | undefined (from server hardware info).
   */
  onPerformanceUpdate?: (info: {
    rtf: number;
    avgRtf: number;
    inferenceMs: number;
    backend?: string;
  }) => void;
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
  stop(skipFlush?: boolean, reason?: string): Promise<void>;
  dispose(): void;
}
