// ---------------------------------------------------------------------------
// Azure Speech provider — robust continuous recognition for long sessions
// ---------------------------------------------------------------------------

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { SpeechCallbacks, SpeechProvider } from "../../types";
import { traceEvent } from "../../../speechTraceStore";

// Event coverage:
// - session:start / session:stop-requested / session:stopped
// - result:interim / result:final plus Azure-specific reconciliation diagnostics
// - transport:connected / transport:disconnected
// Azure browser SDK owns microphone input internally, so session events are
// authoritative but mic:* hardware lifecycle events are not.

const MAX_AUTO_RESTARTS = 5;

// Shorter segmentation → more frequent final results → less text at risk per
// turn if a connection drop or post-processing trim happens.
// Used as fallback when Semantic Segmentation is unavailable for the locale.
const SEGMENTATION_SILENCE_MS = "500";

// If the final recognized text is shorter than this fraction of the last
// interim text, prefer the interim.  Azure's language model sometimes trims
// long utterances significantly, which looks like text loss to the user.
const INTERIM_PREFER_RATIO = 0.5;

// When a new interim is shorter than this fraction of the previous interim
// AND shares no common prefix, treat it as a turn boundary and flush.
const TURN_BOUNDARY_RATIO = 0.75;

export class AzureSpeechProvider implements SpeechProvider {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private audioConfig: sdk.AudioConfig | null = null;
  private callbacks: SpeechCallbacks | null = null;
  private intentionallyStopped = false;
  private restartCount = 0;
  private lastResultId: string | null = null;
  private lastInterimText = "";

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

  stop(_skipFlush = false, reason = "unspecified"): Promise<void> {
    this.intentionallyStopped = true;
    traceEvent("info", "session:stop-requested", `Azure Speech stop requested (reason=${reason})`);
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

    // InitialSilenceTimeoutMs: if only silence is heard at session start, the
    // SDK gives up after this duration.  Must exceed the app's own silence
    // timer so the SDK never kills the session first.  Note: the JS browser
    // SDK does not always honor this reliably (see TIME_GAP_FLUSH_MS).
    const sdkTimeoutMs = String(Math.max(60000, (this.silenceTimeoutSeconds + 15) * 1000));
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, sdkTimeoutMs);
    // EndSilenceTimeoutMs is deprecated in the JS SDK and unreliable — omitted.
    // Semantic Segmentation (SDK 1.41+, MS best practice for dictation): segments
    // on sentence-ending punctuation instead of waiting for silence gaps.  This
    // is the primary fix for interim text that stays uncommitted for many seconds.
    // Falls back to silence-based segmentation for unsupported locales.
    speechConfig.setProperty("Speech_SegmentationStrategy", "Semantic");
    // Speech_SegmentationSilenceTimeoutMs: fallback hint for locales where
    // Semantic Segmentation is unavailable.  The JS browser SDK does not
    // reliably honor this; interimAgeTimer is the client-side backstop.
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
        traceEvent("info", "transport:connected", "WebSocket connected");
      };
      conn.disconnected = () => {
        traceEvent("warn", "transport:disconnected", "WebSocket disconnected");
      };
    } catch { /* Connection API may not be available in all SDK builds */ }

    // --- Event handlers ---

    rec.recognizing = (_s, e) => {
      const newText = e.result.text;
      // Ignore empty recognizing events that some SDK versions emit.
      if (!newText) return;

      // Detect turn boundary: Azure started a new recognition turn WITHOUT
      // firing a `recognized` event for the previous one.  This happens when
      // Azure's segmentation silently discards the previous turn's final.
      // Heuristic: old interim has substantial content, new text is much
      // shorter AND shares no common prefix → flush old as final segment.
      if (
        this.lastInterimText.length > 10 &&
        newText.length < this.lastInterimText.length * TURN_BOUNDARY_RATIO &&
        !this.sharePrefix(this.lastInterimText, newText)
      ) {
        this.flushPendingInterim("turn-boundary");
      }

      this.lastInterimText = newText;
      traceEvent("event", "result:interim", `interim (${newText.length} chars): ${newText.slice(0, 80)}${newText.length > 80 ? "…" : ""}`);
      cb.onInterim(newText);
    };

    rec.recognized = (_s, e) => {
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
        traceEvent("data", "result:final", `final (${finalText.length} chars): ${finalText.slice(0, 120)}${finalText.length > 120 ? "…" : ""}`);
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

    // speechEndDetected: Azure detected the end of speech.  Don't flush
    // immediately — `recognized` typically follows within <100ms with
    // properly capitalized/punctuated text.  Instead, tell the manager to
    // expire the deadline so the next wake event flushes if `recognized`
    // never arrives.
    rec.speechEndDetected = () => {
      traceEvent("event", "speechEndDetected", `pending interim: ${this.lastInterimText.length} chars`);
    };

    rec.sessionStopped = () => {
      traceEvent(
        "event",
        "session:stopped",
        `intentional=${this.intentionallyStopped}, restarts=${this.restartCount}, pending interim=${this.lastInterimText.length} chars`,
      );
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
        traceEvent("info", "session:auto-restart", `Restart #${this.restartCount}/${MAX_AUTO_RESTARTS}`);
        this.disposeRecognizer();
        this.createAndStartRecognizer(false);
        return;
      }

      traceEvent("warn", "session:max-restarts", "Max auto-restarts reached, giving up");
      cb.onStatusChange("idle");
    };

    rec.startContinuousRecognitionAsync(
      () => {
        traceEvent("info", "session:start", `Azure Speech session started (initial=${isInitialStart}, lang=${this.languages[0] || "en-US"}, device=${this.microphoneDeviceId || "default"})`);
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
