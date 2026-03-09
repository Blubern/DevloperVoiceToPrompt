// ---------------------------------------------------------------------------
// OS (Web Speech API) provider
// ---------------------------------------------------------------------------

import type { SpeechCallbacks, SpeechProvider } from "./types";
import { getSpeechRecognitionCtor } from "./speechHelpers";

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
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      callbacks.onError("Web Speech API is not available in this browser.");
      callbacks.onStatusChange("error");
      return;
    }

    // Abort any existing recognition to prevent double-start leaks
    if (this.recognition) {
      this.intentionallyStopped = true;
      this.recognition.abort();
      this.recognition = null;
    }

    this.callbacks = callbacks;
    this.intentionallyStopped = false;
    this.restartCount = 0;

    const rec = new SpeechRecognitionCtor();
    rec.lang = this.language;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      if (this.recognition !== rec) return; // stale instance
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
      if (this.recognition !== rec) return; // stale instance
      if (e.error === "aborted" && this.intentionallyStopped) return;
      if (e.error === "no-speech") return; // silent — not a real error
      callbacks.onError(`Speech recognition error: ${e.error}`);
      callbacks.onStatusChange("error");
    };

    rec.onend = () => {
      if (this.recognition !== rec) return; // stale instance
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
          clearTimeout(timeout);
          this.recognition?.removeEventListener("end", onEnd);
          resolve();
        };
        const timeout = setTimeout(() => {
          // Clean up the listener to prevent a leak when the timeout fires first
          this.recognition?.removeEventListener("end", onEnd);
          resolve();
        }, 2000);
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
