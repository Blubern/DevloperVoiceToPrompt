/**
 * Lightweight audio level meter using Web Audio AnalyserNode.
 * Opens its own mic stream (shared with the OS audio subsystem)
 * and reports a normalized 0–1 volume level via a callback.
 */
export class AudioLevelMeter {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private animFrameId: number | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;

  async start(
    onLevel: (level: number) => void,
    deviceId?: string,
  ): Promise<void> {
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser);

      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

      const tick = () => {
        if (!this.analyser || !this.dataArray) return;
        this.analyser.getByteFrequencyData(this.dataArray);

        // Compute average volume (0–255) and normalize to 0–1
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
          sum += this.dataArray[i];
        }
        const avg = sum / this.dataArray.length;
        onLevel(Math.min(avg / 128, 1)); // normalize: 128 ≈ moderate speech

        this.animFrameId = requestAnimationFrame(tick);
      };

      this.animFrameId = requestAnimationFrame(tick);
    } catch {
      // Silently fail — meter is non-critical UI
      onLevel(0);
    }
  }

  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.analyser?.disconnect();
    this.analyser = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.dataArray = null;
  }
}
