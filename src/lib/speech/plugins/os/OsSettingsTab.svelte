<script lang="ts">
  import { SUPPORTED_LANGUAGES } from "../../../settingsStore";
  import { webSpeechAvailable, type AudioDevice } from "../../../speechService";

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

  let browserEngine = $derived.by(() => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'Microsoft Edge (Chromium)';
    if (ua.includes('Chrome/')) return 'Chromium-based (WebView2)';
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'WebKit (Safari/WKWebView)';
    if (ua.includes('Firefox/')) return 'Firefox';
    return 'Unknown';
  });
</script>

<div class="section">
  <h2>Web Speech Settings</h2>
  {#if !webSpeechAvailable}
    <div class="provider-warn-banner">Web Speech API is not available in this browser environment.</div>
  {/if}
  <div class="speech-notice">
    <div class="notice-icon" title="Info">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>Speech Recognition Notice</strong>
      <p>Web Speech uses your browser's built-in speech recognition engine. Depending on the browser, audio may be sent to a cloud service for processing.</p>
      <p class="browser-info"><span class="browser-badge">{browserEngine}</span></p>
      <p>For details, see the <a href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API" target="_blank" rel="noopener noreferrer" class="notice-link">MDN Web Speech API documentation</a>.</p>
    </div>
  </div>
  <label class="field">
    <span class="label">Language</span>
    <select bind:value={config.language}>
      {#each SUPPORTED_LANGUAGES as lang}<option value={lang.code}>{lang.label} ({lang.code})</option>{/each}
    </select>
    <span class="hint">Language for OS speech recognition.</span>
  </label>
  <label class="field toggle-field">
    <span class="label">Auto Restart</span>
    <div class="toggle-row">
      <input type="checkbox" checked={!!config.auto_restart} onchange={(e) => config.auto_restart = (e.target as HTMLInputElement).checked} class="toggle-checkbox" />
      <span class="toggle-label">{config.auto_restart ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Automatically restart recognition when the browser stops it (Web Speech API has session limits).</span>
  </label>
  {#if config.auto_restart}
  <label class="field">
    <span class="label">Max Restarts</span>
    <input type="number" min="1" max="20" value={config.max_restarts} onchange={(e) => config.max_restarts = parseInt((e.target as HTMLInputElement).value) || 3} style="width: 80px;" />
    <span class="hint">Maximum consecutive auto-restarts before giving up (1–20).</span>
  </label>
  {/if}
  <label class="field">
    <span class="label">Microphone</span>
    <select bind:value={microphoneDeviceId}>
      <option value="">System Default</option>
      {#each audioDevices as device}<option value={device.deviceId}>{device.label}</option>{/each}
    </select>
    {#if micWarning}<span class="hint mic-warning">{micWarning}</span>{:else}<span class="hint">Select the microphone to use for dictation.</span>{/if}
  </label>
</div>
