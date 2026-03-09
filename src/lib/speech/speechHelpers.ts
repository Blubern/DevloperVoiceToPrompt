// ---------------------------------------------------------------------------
// Shared speech helpers — microphone permission, device enumeration,
// Azure connection testing
// ---------------------------------------------------------------------------

import type { EnumerateResult } from "./types";

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
  region: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!key || !region) {
    return { ok: false, error: "Speech key and region are required." };
  }
  // Validate region against the known allowlist to prevent SSRF
  const { AZURE_REGIONS } = await import("../settingsStore");
  if (!AZURE_REGIONS.some((r: { value: string }) => r.value === region)) {
    return { ok: false, error: "Invalid Azure region." };
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
      },
    );
    if (resp.ok) return { ok: true };
    if (resp.status === 401) return { ok: false, error: "Invalid API key." };
    if (resp.status === 403) return { ok: false, error: "API key is not authorized for this region." };
    return { ok: false, error: `Azure returned status ${resp.status}.` };
  } catch {
    return { ok: false, error: "Could not reach Azure. Check your internet connection and region." };
  }
}

// ---------------------------------------------------------------------------
// Web Speech API availability detection
// ---------------------------------------------------------------------------

const SpeechRecognitionCtor: typeof SpeechRecognition | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export function detectWebSpeechAvailability(): boolean {
  return SpeechRecognitionCtor !== undefined;
}

export const webSpeechAvailable: boolean = detectWebSpeechAvailability();

/** Returns the SpeechRecognition constructor if available. */
export function getSpeechRecognitionCtor(): typeof SpeechRecognition | undefined {
  return SpeechRecognitionCtor;
}
