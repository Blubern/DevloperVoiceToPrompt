import * as sdk from "microsoft-cognitiveservices-speech-sdk";

export interface SpeechCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "idle" | "listening" | "error") => void;
}

let recognizer: sdk.SpeechRecognizer | null = null;

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export async function enumerateAudioDevices(): Promise<AudioDevice[]> {
  try {
    // Request mic permission first so labels are populated
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` }));
  } catch {
    return [];
  }
}

export function createRecognizer(
  key: string,
  region: string,
  languages: string[],
  microphoneDeviceId?: string
): sdk.SpeechRecognizer {
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);

  // Generous silence timeout so it doesn't cut off while user is editing
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    "15000"
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    "5000"
  );

  const audioConfig = microphoneDeviceId
    ? sdk.AudioConfig.fromMicrophoneInput(microphoneDeviceId)
    : sdk.AudioConfig.fromDefaultMicrophoneInput();

  if (languages.length > 1) {
    // Use auto-detect language with multiple candidates
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(languages);
    return sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);
  } else {
    speechConfig.speechRecognitionLanguage = languages[0] || "en-US";
    return new sdk.SpeechRecognizer(speechConfig, audioConfig);
  }
}

export function startContinuousRecognition(
  rec: sdk.SpeechRecognizer,
  callbacks: SpeechCallbacks
): void {
  recognizer = rec;

  rec.recognizing = (_s, e) => {
    callbacks.onInterim(e.result.text);
  };

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

  rec.sessionStopped = () => {
    callbacks.onStatusChange("idle");
  };

  rec.startContinuousRecognitionAsync(
    () => callbacks.onStatusChange("listening"),
    (err) => {
      callbacks.onError(String(err));
      callbacks.onStatusChange("error");
    }
  );
}

export function stopContinuousRecognition(): Promise<void> {
  return new Promise((resolve) => {
    if (recognizer) {
      recognizer.stopContinuousRecognitionAsync(
        () => {
          resolve();
        },
        () => {
          resolve();
        }
      );
    } else {
      resolve();
    }
  });
}

export function disposeRecognizer(): void {
  if (recognizer) {
    recognizer.close();
    recognizer = null;
  }
}
