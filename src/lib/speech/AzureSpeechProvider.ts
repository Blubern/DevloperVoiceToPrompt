// ---------------------------------------------------------------------------
// Azure Speech provider
// ---------------------------------------------------------------------------

import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { SpeechCallbacks, SpeechProvider } from "./types";

export class AzureSpeechProvider implements SpeechProvider {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private audioConfig: sdk.AudioConfig | null = null;

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
    if (this.audioConfig) {
      this.audioConfig.close();
      this.audioConfig = null;
    }
  }
}
