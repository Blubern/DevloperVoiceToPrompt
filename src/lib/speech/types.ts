// ---------------------------------------------------------------------------
// Shared types for speech providers
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
  /**
   * Called after each Whisper decode with performance metrics.
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
  /** Clear internal pending-interim state so the provider won't flush
   *  text that the UI already committed (e.g. on user edit or cursor move). */
  clearPendingInterim(): void;
}
