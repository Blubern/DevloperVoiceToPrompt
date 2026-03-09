// ---------------------------------------------------------------------------
// Azure Speech provider
// ---------------------------------------------------------------------------

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { SpeechCallbacks, SpeechProvider } from "./types";

const MAX_AUTO_RESTARTS = 5;

export class AzureSpeechProvider implements SpeechProvider {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private audioConfig: sdk.AudioConfig | null = null;
  private intentionallyStopped = false;
  private restartCount = 0;
  private lastResultId: string | null = null;

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

  start(callbacks: SpeechCallbacks): void {
    this.intentionallyStopped = false;
    this.restartCount = 0;
    this.lastResultId = null;

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);

    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "15000");
    // Always exceed the app's silence timer so the SDK never kills the session
    // before the app does. Add a 15 s buffer (minimum 60 s).
    const endSilenceMs = Math.max(60000, (this.silenceTimeoutSeconds + 15) * 1000);
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, String(endSilenceMs));

    if (!this.autoPunctuation) {
      speechConfig.setProperty("postprocessingoption", "0");
    }

    this.audioConfig = this.microphoneDeviceId
      ? sdk.AudioConfig.fromMicrophoneInput(this.microphoneDeviceId)
      : sdk.AudioConfig.fromDefaultMicrophoneInput();

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

    rec.recognizing = (_s, e) => callbacks.onInterim(e.result.text);
    rec.recognized = (_s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        // Deduplicate: the SDK can fire the same result more than once.
        if (e.result.resultId && e.result.resultId === this.lastResultId) return;
        this.lastResultId = e.result.resultId ?? null;
        callbacks.onFinal(e.result.text);
      }
    };
    rec.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        callbacks.onError(e.errorDetails || "Recognition error");
        callbacks.onStatusChange("error");
      }
    };
    rec.sessionStopped = () => {
      if (this.intentionallyStopped) {
        callbacks.onStatusChange("idle");
        return;
      }
      // Auto-restart: Azure may stop the session on long silence or transient issues.
      if (this.restartCount < MAX_AUTO_RESTARTS && this.recognizer) {
        this.restartCount++;
        this.recognizer.startContinuousRecognitionAsync(
          () => {}, // already "listening" — no need to notify again
          () => callbacks.onStatusChange("idle"), // restart failed → give up
        );
        return;
      }
      callbacks.onStatusChange("idle");
    };

    rec.startContinuousRecognitionAsync(
      () => callbacks.onStatusChange("listening"),
      (err) => {
        callbacks.onError(String(err));
        callbacks.onStatusChange("error");
      },
    );
  }

  stop(): Promise<void> {
    this.intentionallyStopped = true;
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
    if (this.recognizer) {
      const rec = this.recognizer;
      this.recognizer = null;
      // Stop before closing to avoid SDK emitting events on a torn-down object.
      rec.stopContinuousRecognitionAsync(
        () => rec.close(),
        () => rec.close(),
      );
    }
    if (this.audioConfig) {
      this.audioConfig.close();
      this.audioConfig = null;
    }
  }
}
