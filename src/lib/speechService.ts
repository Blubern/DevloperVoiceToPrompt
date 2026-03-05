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

export interface EnumerateResult {
  devices: AudioDevice[];
  error?: string;
}

export async function checkMicrophonePermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state;
  } catch {
    return "unknown";
  }
}

export async function enumerateAudioDevices(): Promise<EnumerateResult> {
  try {
    // Request mic permission first so labels are populated
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      devices: devices
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone (${d.deviceId.slice(0, 8)})` })),
    };
  } catch (e) {
    const err = e instanceof DOMException ? e : null;
    if (err?.name === "NotAllowedError") {
      return { devices: [], error: "Microphone access was denied. Please allow microphone access in your system settings." };
    }
    if (err?.name === "NotFoundError") {
      return { devices: [], error: "No microphone found. Please connect a microphone and try again." };
    }
    return { devices: [], error: "Could not access microphone. Please check your audio device and permissions." };
  }
}

export async function testAzureConnection(
  key: string,
  region: string
): Promise<{ ok: boolean; error?: string }> {
  if (!key || !region) {
    return { ok: false, error: "Speech key and region are required." };
  }
  try {
    const resp = await fetch(
      `https://${encodeURIComponent(region)}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Length": "0",
        },
      }
    );
    if (resp.ok) {
      return { ok: true };
    }
    if (resp.status === 401) {
      return { ok: false, error: "Invalid API key." };
    }
    if (resp.status === 403) {
      return { ok: false, error: "API key is not authorized for this region." };
    }
    return { ok: false, error: `Azure returned status ${resp.status}.` };
  } catch (e) {
    return { ok: false, error: "Could not reach Azure. Check your internet connection and region." };
  }
}

export function createRecognizer(
  key: string,
  region: string,
  languages: string[],
  microphoneDeviceId?: string,
  phraseList?: string[],
  autoPunctuation?: boolean
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

  // Disable automatic punctuation and ITN (inverse text normalization) unless enabled
  if (!autoPunctuation) {
    speechConfig.setProperty("postprocessingoption", "0");
  }

  const audioConfig = microphoneDeviceId
    ? sdk.AudioConfig.fromMicrophoneInput(microphoneDeviceId)
    : sdk.AudioConfig.fromDefaultMicrophoneInput();

  let recognizerInstance: sdk.SpeechRecognizer;

  if (languages.length > 1) {
    // Use auto-detect language with multiple candidates
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(languages);
    recognizerInstance = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetect, audioConfig);
  } else {
    speechConfig.speechRecognitionLanguage = languages[0] || "en-US";
    recognizerInstance = new sdk.SpeechRecognizer(speechConfig, audioConfig);
  }

  if (phraseList && phraseList.length > 0) {
    const grammar = sdk.PhraseListGrammar.fromRecognizer(recognizerInstance);
    for (const phrase of phraseList) {
      grammar.addPhrase(phrase);
    }
  }

  return recognizerInstance;
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
