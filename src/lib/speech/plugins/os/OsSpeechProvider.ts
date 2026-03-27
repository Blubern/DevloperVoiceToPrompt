// ---------------------------------------------------------------------------
// OS (Web Speech API) provider
// ---------------------------------------------------------------------------

import type { SpeechCallbacks, SpeechProvider } from "../../types";
import { getSpeechRecognitionCtor } from "../../speechHelpers";
import { traceEvent } from "../../../speechTraceStore";

// Event coverage:
// - session:start / session:stop-requested / session:stopped
// - result:interim / result:final
// - session:auto-restart / session:restart-failed
// Web Speech does not expose MediaStreamTrack lifecycle, so it does not emit
// authoritative mic:muted / mic:unmuted / mic:ended events.

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
          traceEvent("data", "result:final", `final (${result[0].transcript.length} chars): ${result[0].transcript.slice(0, 120)}${result[0].transcript.length > 120 ? "…" : ""}`);
          callbacks.onFinal(result[0].transcript);
        } else {
          traceEvent("event", "result:interim", `interim (${result[0].transcript.length} chars): ${result[0].transcript.slice(0, 80)}${result[0].transcript.length > 80 ? "…" : ""}`);
          callbacks.onInterim(result[0].transcript);
        }
      }
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (this.recognition !== rec) return; // stale instance
      if (e.error === "aborted" && this.intentionallyStopped) return;
      if (e.error === "no-speech") return; // silent — not a real error
      traceEvent("warn", "error", `Speech recognition error: ${e.error}`);
      callbacks.onError(`Speech recognition error: ${e.error}`);
      callbacks.onStatusChange("error");
    };

    rec.onend = () => {
      if (this.recognition !== rec) return; // stale instance
      if (this.intentionallyStopped) {
        traceEvent("event", "session:stopped", "Intentional stop");
        callbacks.onStatusChange("idle");
        return;
      }
      // Auto-restart logic
      if (this.autoRestart && this.restartCount < this.maxRestarts) {
        this.restartCount++;
        traceEvent("info", "session:auto-restart", `Restart #${this.restartCount}/${this.maxRestarts}`);
        try {
          rec.start();
        } catch {
          traceEvent("warn", "session:restart-failed", "Failed to restart recognition");
          callbacks.onStatusChange("idle");
        }
        return;
      }
      traceEvent("event", "session:stopped", `No more restarts (${this.restartCount}/${this.maxRestarts})`);
      callbacks.onStatusChange("idle");
    };

    this.recognition = rec;
    try {
      rec.start();
      traceEvent("info", "session:start", `OS Speech session started (lang=${this.language})`);
      callbacks.onStatusChange("listening");
    } catch (err) {
      traceEvent("warn", "start-failed", `Failed to start: ${String(err)}`);
      callbacks.onError(String(err));
      callbacks.onStatusChange("error");
    }
  }

  stop(_skipFlush = false, reason = "unspecified"): Promise<void> {
    return new Promise((resolve) => {
      this.intentionallyStopped = true;
      traceEvent("info", "session:stop-requested", `OS Speech stop requested (reason=${reason})`);
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
