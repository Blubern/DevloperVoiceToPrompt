<script lang="ts">
  import { SUPPORTED_LANGUAGES } from "../../../settingsStore";
  import type { AudioDevice } from "../../../speechService";

  let {
    config = $bindable(),
    audioDevices,
    micWarning,
    microphoneDeviceId = $bindable(),
  }: {
    config: Record<string, unknown>;
    audioDevices: AudioDevice[];
    micWarning: string;
    microphoneDeviceId: string;
  } = $props();
</script>

<div class="section">
  <h2>Apple Speech Settings</h2>
  <div class="speech-notice">
    <div class="notice-icon" title="Info">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>macOS Native Speech Recognition</strong>
      <p>Uses Apple's SFSpeechRecognizer for speech-to-text. Audio may be sent to Apple's servers unless on-device recognition is enabled.</p>
      <p>Requires <strong>Speech Recognition</strong> permission in System Settings → Privacy & Security.</p>
    </div>
  </div>
  <label class="field">
    <span class="label">Language</span>
    <select bind:value={config.language}>
      {#each SUPPORTED_LANGUAGES as lang}<option value={lang.code}>{lang.label} ({lang.code})</option>{/each}
    </select>
    <span class="hint">Language for Apple Speech recognition.</span>
  </label>
  <label class="field toggle-field">
    <span class="label">On-Device Recognition</span>
    <div class="toggle-row">
      <input type="checkbox" checked={!!config.on_device} onchange={(e) => config.on_device = (e.target as HTMLInputElement).checked} class="toggle-checkbox" />
      <span class="toggle-label">{config.on_device ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Process speech locally without sending audio to Apple's servers. Not all languages support on-device recognition.</span>
  </label>
  <label class="field">
    <span class="label">Microphone</span>
    <select bind:value={microphoneDeviceId}>
      <option value="">System Default</option>
      {#each audioDevices as device}<option value={device.deviceId}>{device.label}</option>{/each}
    </select>
    {#if micWarning}<span class="hint mic-warning">{micWarning}</span>{:else}<span class="hint">Select the microphone to use for dictation.</span>{/if}
  </label>
</div>
