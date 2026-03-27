<script lang="ts">
  import { SUPPORTED_LANGUAGES, AZURE_REGIONS } from "../../../settingsStore";
  import { testAzureConnection, type AudioDevice } from "../../../speechService";

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

  let showKey = $state(false);
  let langFilter = $state("");
  let apiStatus = $state<"idle" | "checking" | "ok" | "error">("idle");
  let apiError = $state("");

  let languages = $derived((config.languages as string[]) ?? ["en-US"]);

  let filteredLanguages = $derived(
    langFilter
      ? SUPPORTED_LANGUAGES.filter(
          (l) =>
            l.label.toLowerCase().includes(langFilter.toLowerCase()) ||
            l.code.toLowerCase().includes(langFilter.toLowerCase())
        )
      : SUPPORTED_LANGUAGES
  );

  async function checkConnection() {
    const key = config.speech_key as string;
    const region = config.region as string;
    if (!key || !region) {
      apiStatus = "error";
      apiError = "Enter a speech key and region first.";
      return;
    }
    apiStatus = "checking";
    apiError = "";
    const result = await testAzureConnection(key, region);
    if (result.ok) { apiStatus = "ok"; apiError = ""; }
    else { apiStatus = "error"; apiError = result.error ?? "Connection failed."; }
  }

  function toggleLanguage(code: string) {
    const current = languages;
    if (current.includes(code)) {
      if (current.length > 1) config.languages = current.filter((l) => l !== code);
    } else {
      config.languages = [...current, code];
    }
  }
</script>

<div class="section">
  <h2>Azure Speech Service</h2>
  <label class="field">
    <span class="label">Speech Key</span>
    <div class="input-row">
      <input type={showKey ? "text" : "password"} value={config.speech_key ?? ""} oninput={(e) => config.speech_key = (e.target as HTMLInputElement).value} placeholder="Enter your Azure Speech key" autocomplete="off" />
      <button type="button" class="toggle-btn" onclick={() => (showKey = !showKey)}>{showKey ? "Hide" : "Show"}</button>
    </div>
  </label>
  <label class="field">
    <span class="label">Region</span>
    <select value={config.region ?? "eastus"} onchange={(e) => config.region = (e.target as HTMLSelectElement).value}>
      {#each AZURE_REGIONS as r}<option value={r.value}>{r.label} ({r.value})</option>{/each}
    </select>
  </label>
  <div class="field">
    <span class="label">Connection Status</span>
    <div class="connection-row">
      <button type="button" class="test-btn" onclick={checkConnection} disabled={apiStatus === 'checking'}>
        {apiStatus === 'checking' ? 'Checking...' : 'Test Connection'}
      </button>
      <span class="status-dot" class:dot-ok={apiStatus === 'ok'} class:dot-error={apiStatus === 'error'} class:dot-checking={apiStatus === 'checking'}
        title={apiStatus === 'ok' ? 'Connected' : apiStatus === 'error' ? apiError : apiStatus === 'checking' ? 'Checking...' : 'Not tested'}></span>
      {#if apiStatus === 'ok'}<span class="connection-text ok">Connected</span>
      {:else if apiStatus === 'error'}<span class="connection-text err" title={apiError}>{apiError}</span>{/if}
    </div>
  </div>
  <div class="field">
    <span class="label">Languages ({languages.length} selected)</span>
    <input type="text" bind:value={langFilter} placeholder="Filter languages..." class="lang-filter" />
    <div class="lang-list">
      {#each filteredLanguages as lang}
        <label class="lang-item">
          <input type="checkbox" checked={languages.includes(lang.code)} onchange={() => toggleLanguage(lang.code)} />
          <span>{lang.label}</span><span class="lang-code">{lang.code}</span>
        </label>
      {/each}
    </div>
    <span class="hint">Select one or more. Multiple languages enable auto-detection.</span>
  </div>
  <label class="field">
    <span class="label">Microphone</span>
    <select bind:value={microphoneDeviceId}>
      <option value="">System Default</option>
      {#each audioDevices as device}<option value={device.deviceId}>{device.label}</option>{/each}
    </select>
    {#if micWarning}<span class="hint mic-warning">{micWarning}</span>{:else}<span class="hint">Select the microphone to use for dictation.</span>{/if}
  </label>
  <label class="field toggle-field">
    <span class="label">Auto Punctuation</span>
    <div class="toggle-row">
      <input type="checkbox" checked={!!config.auto_punctuation} onchange={(e) => config.auto_punctuation = (e.target as HTMLInputElement).checked} class="toggle-checkbox" />
      <span class="toggle-label">{config.auto_punctuation ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Automatically add punctuation and capitalization to dictated text (Azure only).</span>
  </label>
</div>
