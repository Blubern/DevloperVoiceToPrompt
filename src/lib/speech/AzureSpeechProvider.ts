// ---------------------------------------------------------------------------
// Azure Speech provider — robust continuous recognition for long sessions
// ---------------------------------------------------------------------------

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { SpeechCallbacks, SpeechProvider } from "./types";
import { traceEvent } from "../speechTraceStore";

const MAX_AUTO_RESTARTS = 5;

// Shorter segmentation → more frequent final results → less text at risk per
// turn if a connection drop or post-processing trim happens.
const SEGMENTATION_SILENCE_MS = "800";

// If the final recognized text is shorter than this fraction of the last
// interim text, prefer the interim.  Azure's language model sometimes trims
// long utterances significantly, which looks like text loss to the user.
const INTERIM_PREFER_RATIO = 0.5;

export class AzureSpeechProvider implements SpeechProvider {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private audioConfig: sdk.AudioConfig | null = null;
  private callbacks: SpeechCallbacks | null = null;
  private intentionallyStopped = false;
  private restartCount = 0;
  private lastResultId: string | null = null;
  private lastInterimText = "";
  private speechEndTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private key: string,
    private region: string,
    private languages: string[],
    private silenceTimeoutSeconds: number,
    private microphoneDeviceId?: string,
    private phraseList?: string[],
    private autoPunctuation?: boolean,
  ) {
    // Ensure at least one language is present so languages[0] is always defined.
    if (this.languages.length === 0) {
      this.languages = ["en-US"];
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  start(callbacks: SpeechCallbacks): void {
    this.callbacks = callbacks;
    this.disposeRecognizer();

    this.intentionallyStopped = false;
    this.restartCount = 0;
    this.lastResultId = null;
    this.lastInterimText = "";

    this.audioConfig = this.microphoneDeviceId
      ? sdk.AudioConfig.fromMicrophoneInput(this.microphoneDeviceId)
      : sdk.AudioConfig.fromDefaultMicrophoneInput();

    this.createAndStartRecognizer(true);
  }

  stop(): Promise<void> {
    this.intentionallyStopped = true;
    this.clearSpeechEndTimer();
    return new Promise((resolve) => {
      if (this.recognizer) {
        this.recognizer.stopContinuousRecognitionAsync(() => resolve(), () => resolve());
      } else {
        resolve();
      }
    });
  }

  dispose(): void {
    this.intentionallyStopped = true;
    this.clearSpeechEndTimer();
    this.disposeRecognizer();
    if (this.audioConfig) {
      this.audioConfig.close();
      this.audioConfig = null;
    }
    this.callbacks = null;
  }

  // -----------------------------------------------------------------------
  // Recognizer setup — extracted so auto-restart can create a fresh instance
  // -----------------------------------------------------------------------

  private createAndStartRecognizer(isInitialStart: boolean): void {
    const cb = this.callbacks;
    if (!cb || !this.audioConfig) return;

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);

    // Both timeouts must exceed the app's own silence timer so the SDK never
    // kills the session before the app does.  Add a 15 s buffer (minimum 60 s).
    const sdkTimeoutMs = String(Math.max(60000, (this.silenceTimeoutSeconds + 15) * 1000));
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, sdkTimeoutMs);
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, sdkTimeoutMs);
    speechConfig.setProperty("Speech_SegmentationSilenceTimeoutMs", SEGMENTATION_SILENCE_MS);

    // Enable dictation mode for better punctuation, capitalization, and
    // support for longer utterances (Microsoft best practice for dictation apps).
    speechConfig.enableDictation();

    if (!this.autoPunctuation) {
      speechConfig.setProperty("postprocessingoption", "0");
    }

    let rec: sdk.SpeechRecognizer;

    if (this.languages.length > 1) {
      const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(this.languages);
      rec = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, this.audioConfig);
    } else {
      speechConfig.speechRecognitionLanguage = this.languages[0] || "en-US";
      rec = new sdk.SpeechRecognizer(speechConfig, this.audioConfig);
    }

    if (this.phraseList && this.phraseList.length > 0) {
      const grammar = sdk.PhraseListGrammar.fromRecognizer(rec);
      for (const phrase of this.phraseList) {
        grammar.addPhrase(phrase);
      }
    }

    this.recognizer = rec;

    // --- Connection-level monitoring (diagnostic) ---
    try {
      const conn = sdk.Connection.fromRecognizer(rec);
      conn.connected = () => {
        traceEvent("info", "ws-connected", "WebSocket connected");
      };
      conn.disconnected = () => {
        traceEvent("warn", "ws-disconnected", "WebSocket disconnected");
      };
    } catch { /* Connection API may not be available in all SDK builds */ }

    // --- Event handlers ---

    rec.recognizing = (_s, e) => {
      this.clearSpeechEndTimer();
      const newText = e.result.text;

      // Detect turn boundary: Azure started a new recognition turn WITHOUT
      // firing a `recognized` event for the previous one.  This happens when
      // Azure's segmentation silently discards the previous turn's final.
      // Heuristic: old interim has substantial content, new text is much
      // shorter AND shares no common prefix → flush old as final segment.
      if (
        this.lastInterimText.length > 15 &&
        newText.length < this.lastInterimText.length * 0.6 &&
        !this.sharePrefix(this.lastInterimText, newText)
      ) {
        this.flushPendingInterim("turn-boundary");
      }

      this.lastInterimText = newText;
      traceEvent("event", "recognizing", `interim (${newText.length} chars): ${newText.slice(0, 80)}${newText.length > 80 ? "…" : ""}`);
      cb.onInterim(newText);
    };

    rec.recognized = (_s, e) => {
      this.clearSpeechEndTimer();

      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        // Deduplicate: the SDK can fire the same result more than once.
        if (e.result.resultId && e.result.resultId === this.lastResultId) return;
        this.lastResultId = e.result.resultId ?? null;

        // Reconcile: if Azure's final text is drastically shorter than the
        // interim the user was seeing, prefer the interim to avoid visible
        // text loss.  Azure's language model can aggressively trim long
        // utterances which looks like data loss in a dictation tool.
        const recognized = e.result.text;
        const interim = this.lastInterimText;
        let finalText: string;
        if (
          interim.length > 0 &&
          recognized.length < interim.length * INTERIM_PREFER_RATIO
        ) {
          traceEvent(
            "warn",
            "recognized-short",
            `Preferring interim (${interim.length} chars) over recognized (${recognized.length} chars). Interim: "${interim.slice(0, 100)}…" / Recognized: "${recognized.slice(0, 100)}…"`,
          );
          finalText = interim;
        } else {
          finalText = recognized;
        }

        this.lastInterimText = "";
        // Reset restart budget on every successful recognition so long
        // sessions don't exhaust the limit.
        this.restartCount = 0;
        traceEvent("data", "recognized", `final (${finalText.length} chars): ${finalText.slice(0, 120)}${finalText.length > 120 ? "…" : ""}`);
        // Log interim vs recognized comparison for text-loss diagnosis
        if (interim.length > 0 && recognized.length !== interim.length) {
          const delta = recognized.length - interim.length;
          traceEvent("info", "interim-vs-final", `interim=${interim.length}, recognized=${recognized.length} (${delta >= 0 ? "+" : ""}${delta}, ${Math.round(recognized.length / interim.length * 100)}%)`);
        }
        cb.onFinal(finalText);

      } else if (e.result.reason === sdk.ResultReason.NoMatch) {
        // NoMatch can fire after recognizing events accumulated interim text.
        // Without flushing, that interim would be silently discarded when the
        // next turn overwrites lastInterimText.
        const noMatchDetail = sdk.NoMatchDetails.fromResult(e.result);
        const reason = sdk.NoMatchReason[noMatchDetail.reason] ?? String(noMatchDetail.reason);
        if (this.lastInterimText) {
          traceEvent("info", "nomatch", `NoMatch (${reason}) — flushing pending interim`);
          this.flushPendingInterim("nomatch");
        } else {
          traceEvent("event", "nomatch", `NoMatch (${reason}) — no pending interim`);
        }
      }
    };

    rec.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        traceEvent("warn", "canceled", `Error: ${e.errorDetails || "unknown"} (code=${e.errorCode})`);
        cb.onError(e.errorDetails || "Recognition error");
        cb.onStatusChange("error");
      } else if (e.reason === sdk.CancellationReason.EndOfStream) {
        traceEvent("info", "canceled", "EndOfStream — audio input ended");
        this.flushPendingInterim("endofstream");
      }
    };

    // Safety net: if speech ends but no recognized event follows within 2 s,
    // flush any pending interim text so it isn't lost in the gap.
    rec.speechEndDetected = () => {
      traceEvent("event", "speechEndDetected", `pending interim: ${this.lastInterimText.length} chars`);
      if (this.lastInterimText) {
        this.clearSpeechEndTimer();
        this.speechEndTimer = setTimeout(() => {
          this.flushPendingInterim("speechEnd-timeout");
        }, 1200);
      }
    };

    rec.sessionStopped = () => {
      traceEvent(
        "event",
        "sessionStopped",
        `intentional=${this.intentionallyStopped}, restarts=${this.restartCount}, pending interim=${this.lastInterimText.length} chars`,
      );
      this.clearSpeechEndTimer();
      this.flushPendingInterim("sessionStopped");

      if (this.intentionallyStopped) {
        cb.onStatusChange("idle");
        return;
      }

      // Auto-restart with a **fresh** recognizer.  Reusing the old instance
      // after Azure recycles the WebSocket connection can leave it in a
      // degraded state where events stop firing.
      if (this.restartCount < MAX_AUTO_RESTARTS) {
        this.restartCount++;
        traceEvent("info", "auto-restart", `Restart #${this.restartCount}/${MAX_AUTO_RESTARTS}`);
        this.disposeRecognizer();
        this.createAndStartRecognizer(false);
        return;
      }

      traceEvent("warn", "max-restarts", "Max auto-restarts reached, giving up");
      cb.onStatusChange("idle");
    };

    rec.startContinuousRecognitionAsync(
      () => {
        traceEvent("info", "started", `Recognition started (initial=${isInitialStart})`);
        if (isInitialStart) cb.onStatusChange("listening");
      },
      (err) => {
        traceEvent("warn", "start-failed", `Failed to start: ${String(err)}`);
        cb.onError(String(err));
        cb.onStatusChange("error");
      },
    );
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private disposeRecognizer(): void {
    if (this.recognizer) {
      const rec = this.recognizer;
      this.recognizer = null;
      // Stop before closing to avoid SDK emitting events on a torn-down object.
      rec.stopContinuousRecognitionAsync(
        () => { try { rec.close(); } catch { /* ignore */ } },
        () => { try { rec.close(); } catch { /* ignore */ } },
      );
    }
  }

  private clearSpeechEndTimer(): void {
    if (this.speechEndTimer) {
      clearTimeout(this.speechEndTimer);
      this.speechEndTimer = null;
    }
  }

  /** Flush pending interim text as a final segment, if any. */
  private flushPendingInterim(source: string): void {
    if (this.lastInterimText && this.callbacks) {
      traceEvent("warn", `flush-${source}`, `Flushing interim (${this.lastInterimText.length} chars): ${this.lastInterimText.slice(0, 100)}${this.lastInterimText.length > 100 ? "\u2026" : ""}`);
      this.callbacks.onFinal(this.lastInterimText);
      this.lastInterimText = "";
    }
  }

  /** Check if two strings share a common prefix (first ~12 chars). */
  private sharePrefix(a: string, b: string): boolean {
    const prefixLen = Math.min(a.length, b.length, 12);
    if (prefixLen < 3) return false;
    return a.slice(0, prefixLen).toLowerCase() === b.slice(0, prefixLen).toLowerCase();
  }
}
