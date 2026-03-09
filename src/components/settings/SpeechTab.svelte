<script lang="ts">
  import { SUPPORTED_LANGUAGES, AZURE_REGIONS } from "../../lib/settingsStore";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { testAzureConnection, webSpeechAvailable, type AudioDevice } from "../../lib/speechService";
  import { EVENT_WHISPER_DOWNLOAD_PROGRESS, PROVIDER_AZURE, PROVIDER_WHISPER } from "../../lib/constants";
  import { onMount } from "svelte";

  let {
    speechProvider = $bindable(),
    osLanguage = $bindable(),
    osAutoRestart = $bindable(),
    osMaxRestarts = $bindable(),
    key = $bindable(),
    region = $bindable(),
    languages = $bindable(),
    microphoneDeviceId = $bindable(),
    autoPunctuation = $bindable(),
    whisperModel = $bindable(),
    whisperLanguage = $bindable(),
    whisperChunkSeconds = $bindable(),
    whisperDecodeInterval = $bindable(),
    whisperContextOverlap = $bindable(),
    audioDevices,
    micWarning,
    error = $bindable(),
  }: {
    speechProvider: "os" | "azure" | "whisper";
    osLanguage: string;
    osAutoRestart: boolean;
    osMaxRestarts: number;
    key: string;
    region: string;
    languages: string[];
    microphoneDeviceId: string;
    autoPunctuation: boolean;
    whisperModel: string;
    whisperLanguage: string;
    whisperChunkSeconds: number;
    whisperDecodeInterval: number;
    whisperContextOverlap: number;
    audioDevices: AudioDevice[];
    micWarning: string;
    error: string;
  } = $props();

  let speechSubTab = $state<"whisper" | "os" | "azure">(speechProvider);
  let showKey = $state(false);
  let langFilter = $state("");
  let apiStatus = $state<"idle" | "checking" | "ok" | "error">("idle");
  let apiError = $state("");

  interface WhisperModelInfo {
    name: string;
    label: string;
    size_mb: number;
    downloaded: boolean;
  }
  let whisperModels = $state<WhisperModelInfo[]>([]);
  let whisperDownloading = $state<string | null>(null);
  let whisperDownloadProgress = $state(0);
  let whisperDownloadTotal = $state(0);

  let browserEngine = $derived.by(() => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'Microsoft Edge (Chromium)';
    if (ua.includes('Chrome/')) return 'Chromium-based (WebView2)';
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'WebKit (Safari/WKWebView)';
    if (ua.includes('Firefox/')) return 'Firefox';
    return 'Unknown';
  });

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
    if (languages.includes(code)) {
      if (languages.length > 1) languages = languages.filter((l) => l !== code);
    } else {
      languages = [...languages, code];
    }
  }

  async function refreshWhisperModels() {
    try { whisperModels = await invoke<WhisperModelInfo[]>("whisper_list_models"); }
    catch { whisperModels = []; }
    // Auto-select: if the current model isn't downloaded, switch to the first that is
    const currentIsDownloaded = whisperModels.some(m => m.name === whisperModel && m.downloaded);
    if (!currentIsDownloaded) {
      const firstDownloaded = whisperModels.find(m => m.downloaded);
      if (firstDownloaded) whisperModel = firstDownloaded.name;
    }
  }

  async function downloadWhisperModel(name: string) {
    whisperDownloading = name;
    whisperDownloadProgress = 0;
    whisperDownloadTotal = 0;
    const unlisten = await listen<{ model: string; downloaded: number; total: number }>(
      EVENT_WHISPER_DOWNLOAD_PROGRESS,
      (event) => {
        if (event.payload.model === name) {
          whisperDownloadProgress = event.payload.downloaded;
          whisperDownloadTotal = event.payload.total;
        }
      }
    );
    try {
      await invoke("whisper_download_model", { modelName: name });
      await refreshWhisperModels();
    } catch (e) { error = `Download failed: ${e}`; }
    finally { unlisten(); whisperDownloading = null; }
  }

  async function deleteWhisperModel(name: string) {
    try { await invoke("whisper_delete_model", { modelName: name }); await refreshWhisperModels(); }
    catch (e) { error = `Delete failed: ${e}`; }
  }

  // Load models on mount
  onMount(() => { refreshWhisperModels(); });
</script>

<div class="section">
  <h2>Speech Provider</h2>
  <label class="field">
    <span class="label">Default Speech Provider</span>
    <select bind:value={speechProvider}>
      <option value="whisper">Whisper (Local)</option>
      <option value="os">Web Speech</option>
      <option value="azure">Azure Speech</option>
    </select>
    <span class="hint">Choose which speech engine is used by default when recording.</span>
  </label>
</div>

<div class="speech-sub-tabs">
  <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'whisper'} onclick={() => speechSubTab = 'whisper'}>Whisper (Local)</button>
  <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'os'} onclick={() => speechSubTab = 'os'}>
    Web Speech
    {#if !webSpeechAvailable}<span class="sub-tab-warn">!</span>{/if}
  </button>
  <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'azure'} onclick={() => speechSubTab = 'azure'}>Azure Speech</button>
</div>

{#if speechSubTab === 'whisper'}
<div class="section">
  <h2>Whisper (Local) Settings</h2>
  <div class="speech-notice">
    <div class="notice-icon" title="Info">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>Local Speech Recognition</strong>
      <p>Whisper runs entirely on your device using <a href="https://github.com/ggerganov/whisper.cpp" target="_blank" rel="noopener noreferrer">whisper.cpp</a> via <a href="https://github.com/tazz4843/whisper-rs" target="_blank" rel="noopener noreferrer">whisper-rs</a>. No data is sent to any cloud service. Download a model below to get started.</p>
    </div>
  </div>
  <div class="field">
    <span class="label">Model</span>
    <select bind:value={whisperModel}>
      {#each whisperModels as m}<option value={m.name} disabled={!m.downloaded}>{m.label}{m.downloaded ? '' : ' (not downloaded)'}</option>{/each}
    </select>
    <span class="hint">Select the Whisper model to use. Larger models are more accurate but slower.</span>
  </div>
  <div class="field">
    <span class="label">Model Management</span>
    <span class="hint">Models are downloaded from <a href="https://huggingface.co/ggerganov/whisper.cpp" target="_blank" rel="noopener noreferrer">HuggingFace (ggerganov/whisper.cpp)</a>.</span>
    <div class="whisper-model-list">
      {#each whisperModels as m}
        <div class="whisper-model-row">
          <span class="whisper-model-name">{m.label}</span>
          {#if m.downloaded}
            <span class="whisper-model-badge downloaded">Downloaded</span>
            <button type="button" class="toggle-btn whisper-delete-btn" onclick={() => deleteWhisperModel(m.name)}>Delete</button>
          {:else if whisperDownloading === m.name}
            <span class="whisper-model-badge downloading">
              {#if whisperDownloadTotal > 0}{Math.round(whisperDownloadProgress / whisperDownloadTotal * 100)}%{:else}Downloading...{/if}
            </span>
          {:else}
            <button type="button" class="toggle-btn" onclick={() => downloadWhisperModel(m.name)} disabled={whisperDownloading !== null}>Download ({m.size_mb} MB)</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <label class="field">
    <span class="label">Language</span>
    <select bind:value={whisperLanguage}>
      {#each SUPPORTED_LANGUAGES as lang}<option value={lang.code}>{lang.label} ({lang.code})</option>{/each}
    </select>
    <span class="hint">Select the language you will be speaking. This improves transcription speed and accuracy.</span>
  </label>
  <label class="field">
    <span class="label">Decode Interval: {whisperDecodeInterval}s</span>
    <input type="range" min="0.5" max="10" step="0.5" bind:value={whisperDecodeInterval} />
    <span class="hint">How often audio is sent to Whisper for transcription. Lower values give faster interim results but use more CPU.</span>
  </label>
  <label class="field">
    <span class="label">Context Overlap: {whisperContextOverlap}s</span>
    <input type="range" min="0" max="3" step="0.5" bind:value={whisperContextOverlap} />
    <span class="hint">Seconds of already-transcribed audio re-sent for context. Helps avoid cut-off words at boundaries.</span>
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
{/if}

{#if speechSubTab === 'os'}
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
    <select bind:value={osLanguage}>
      {#each SUPPORTED_LANGUAGES as lang}<option value={lang.code}>{lang.label} ({lang.code})</option>{/each}
    </select>
    <span class="hint">Language for OS speech recognition.</span>
  </label>
  <label class="field toggle-field">
    <span class="label">Auto Restart</span>
    <div class="toggle-row">
      <input type="checkbox" bind:checked={osAutoRestart} class="toggle-checkbox" />
      <span class="toggle-label">{osAutoRestart ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Automatically restart recognition when the browser stops it (Web Speech API has session limits).</span>
  </label>
  {#if osAutoRestart}
  <label class="field">
    <span class="label">Max Restarts</span>
    <input type="number" min="1" max="20" bind:value={osMaxRestarts} style="width: 80px;" />
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
{/if}

{#if speechSubTab === 'azure'}
<div class="section">
  <h2>Azure Speech Service</h2>
  <label class="field">
    <span class="label">Speech Key</span>
    <div class="input-row">
      <input type={showKey ? "text" : "password"} bind:value={key} placeholder="Enter your Azure Speech key" autocomplete="off" />
      <button type="button" class="toggle-btn" onclick={() => (showKey = !showKey)}>{showKey ? "Hide" : "Show"}</button>
    </div>
  </label>
  <label class="field">
    <span class="label">Region</span>
    <select bind:value={region}>
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
      <input type="checkbox" bind:checked={autoPunctuation} class="toggle-checkbox" />
      <span class="toggle-label">{autoPunctuation ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">Automatically add punctuation and capitalization to dictated text (Azure only).</span>
  </label>
</div>
{/if}
