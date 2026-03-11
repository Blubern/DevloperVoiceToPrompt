<script lang="ts">
  import { SUPPORTED_LANGUAGES, AZURE_REGIONS } from "../../lib/settingsStore";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { testAzureConnection, webSpeechAvailable, type AudioDevice } from "../../lib/speechService";
  import { EVENT_WHISPER_DOWNLOAD_PROGRESS, EVENT_WHISPER_CLI_DOWNLOAD_PROGRESS, PROVIDER_AZURE, PROVIDER_WHISPER, WHISPER_CLI_VARIANTS, WHISPER_DEFAULT_CLI_VERSION } from "../../lib/constants";
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
    whisperCliVersion = $bindable(),
    whisperCliVariant = $bindable(),
    whisperUseGpu = $bindable(),
    speechTracing = $bindable(),
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
    whisperCliVersion: string;
    whisperCliVariant: string;
    whisperUseGpu: boolean;
    speechTracing: boolean;
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

  // CLI binary state
  interface CliStatus {
    installed: boolean;
    version: string | null;
    variant: string | null;
    source: string;
    path: string | null;
  }
  interface GpuInfo {
    has_nvidia: boolean;
    gpu_name: string | null;
    cuda_version: string | null;
    recommended_variant: string;
  }
  let cliStatus = $state<CliStatus | null>(null);
  let gpuInfo = $state<GpuInfo | null>(null);
  let cliDownloading = $state(false);
  let cliDownloadProgress = $state(0);
  let cliDownloadTotal = $state(0);
  let gpuDetecting = $state(false);

  // Server status
  interface ServerStatus {
    running: boolean;
    model_name: string | null;
    port: number | null;
  }
  let serverStatus = $state<ServerStatus | null>(null);
  let serverStarting = $state(false);
  let serverStopping = $state(false);

  let hasDownloadedModel = $derived(whisperModels.some(m => m.downloaded));

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
  onMount(() => {
    refreshWhisperModels();
    refreshCliStatus();
    refreshServerStatus();
  });

  async function refreshServerStatus() {
    try { serverStatus = await invoke<ServerStatus>("whisper_server_status"); }
    catch { serverStatus = null; }
  }

  async function refreshCliStatus() {
    try { cliStatus = await invoke<CliStatus>("whisper_check_cli"); }
    catch { cliStatus = null; }
  }

  async function detectGpu() {
    gpuDetecting = true;
    try {
      gpuInfo = await invoke<GpuInfo>("whisper_detect_gpu");
      // Auto-select recommended variant
      if (gpuInfo?.recommended_variant) {
        whisperCliVariant = gpuInfo.recommended_variant;
      }
    } catch { gpuInfo = null; }
    finally { gpuDetecting = false; }
  }

  async function downloadCli() {
    cliDownloading = true;
    cliDownloadProgress = 0;
    cliDownloadTotal = 0;
    const unlisten = await listen<{ downloaded: number; total: number }>(
      EVENT_WHISPER_CLI_DOWNLOAD_PROGRESS,
      (event) => {
        cliDownloadProgress = event.payload.downloaded;
        cliDownloadTotal = event.payload.total;
      }
    );
    try {
      await invoke("whisper_download_cli", { version: whisperCliVersion, variant: whisperCliVariant });
      await refreshCliStatus();
      // Auto-enable GPU when downloading a CUDA variant
      if (whisperCliVariant.startsWith('cuda')) {
        whisperUseGpu = true;
      }
    } catch (e) { error = `CLI download failed: ${e}`; }
    finally { unlisten(); cliDownloading = false; }
  }

  async function deleteCli() {
    try {
      await invoke("whisper_delete_cli");
      await refreshCliStatus();
      await refreshServerStatus();
    } catch (e) { error = `CLI delete failed: ${e}`; }
  }

  async function startServer() {
    serverStarting = true;
    error = "";
    try {
      const selectedModel = whisperModels.find(m => m.name === whisperModel && m.downloaded);
      if (!selectedModel) { error = "Select a downloaded model first."; return; }
      await invoke("whisper_start_server", {
        modelName: whisperModel,
        language: whisperLanguage,
        useGpu: whisperUseGpu,
      });
      await refreshServerStatus();
    } catch (e) { error = `Server start failed: ${e}`; }
    finally { serverStarting = false; }
  }

  async function stopServer() {
    serverStopping = true;
    error = "";
    try {
      await invoke("whisper_stop_server");
      await refreshServerStatus();
    } catch (e) { error = `Server stop failed: ${e}`; }
    finally { serverStopping = false; }
  }

  async function restartServer() {
    serverStopping = true;
    serverStarting = true;
    error = "";
    try {
      await invoke("whisper_stop_server");
      await invoke("whisper_start_server", {
        modelName: whisperModel,
        language: whisperLanguage,
        useGpu: whisperUseGpu,
      });
      await refreshServerStatus();
    } catch (e) { error = `Server restart failed: ${e}`; }
    finally { serverStopping = false; serverStarting = false; }
  }
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
      <p>Whisper runs entirely on your device using <a href="https://github.com/ggml-org/whisper.cpp" target="_blank" rel="noopener noreferrer">whisper.cpp</a> via a local whisper-server process. No data is sent to any cloud service. Download the CLI binary and a model below to get started.</p>
    </div>
  </div>

  {#if !cliStatus?.installed || !hasDownloadedModel}
  <div class="whisper-setup-checklist">
    <strong>Setup required</strong>
    <ul>
      <li class:done={cliStatus?.installed}>{cliStatus?.installed ? '✓' : '①'} Download the whisper-server binary</li>
      <li class:done={hasDownloadedModel}>{hasDownloadedModel ? '✓' : '②'} Download at least one model</li>
    </ul>
  </div>
  {/if}

  <!-- CLI Binary Management -->
  <div class="field">
    <span class="label">whisper-server Binary</span>
    {#if cliStatus?.installed}
      <div class="whisper-model-row">
        <span class="whisper-model-badge downloaded">
          Installed{cliStatus.version ? ` (v${cliStatus.version})` : ''}{cliStatus.variant ? ` — ${cliStatus.variant}` : ''}{cliStatus.source === 'homebrew' ? ' via Homebrew' : ''}
        </span>
        {#if cliStatus.source === 'download'}
          <button type="button" class="toggle-btn whisper-delete-btn" onclick={deleteCli}
            disabled={serverStatus?.running === true}
            title={serverStatus?.running ? 'Stop the server before removing' : ''}>Remove</button>
        {/if}
      </div>
    {:else if cliDownloading}
      <div class="whisper-model-row">
        <span class="whisper-model-badge downloading">
          {#if cliDownloadTotal > 0}{Math.round(cliDownloadProgress / cliDownloadTotal * 100)}%{:else}Downloading...{/if}
        </span>
      </div>
    {:else}
      <div class="whisper-cli-setup">
        <div class="whisper-cli-row">
          <label class="cli-field">
            <span class="cli-label">Version</span>
            <input type="text" bind:value={whisperCliVersion} style="width: 56px;" />
          </label>
          <label class="cli-field">
            <span class="cli-label">Variant</span>
            <select bind:value={whisperCliVariant}>
              {#each WHISPER_CLI_VARIANTS as v}
                <option value={v.id}>
                  {v.label} ({v.sizeMb} MB)
                  {#if gpuInfo?.recommended_variant === v.id} ★ Recommended{/if}
                </option>
              {/each}
            </select>
          </label>
          <button type="button" class="toggle-btn" onclick={detectGpu} disabled={gpuDetecting}>
            {gpuDetecting ? 'Detecting...' : 'Detect GPU'}
          </button>
        </div>
        {#if gpuInfo}
          <div class="gpu-info">
            {#if gpuInfo.has_nvidia}
              <span class="gpu-badge">🖥️ {gpuInfo.gpu_name ?? 'NVIDIA GPU'} (Driver: {gpuInfo.cuda_version})</span>
            {:else if gpuInfo.gpu_name}
              <span class="gpu-badge">🖥️ {gpuInfo.gpu_name}</span>
            {:else}
              <span class="gpu-badge">No dedicated GPU detected — CPU recommended</span>
            {/if}
          </div>
        {/if}
        <button type="button" class="toggle-btn" onclick={downloadCli}>
          Download whisper-server (v{whisperCliVersion}, {WHISPER_CLI_VARIANTS.find(v => v.id === whisperCliVariant)?.label ?? whisperCliVariant})
        </button>
      </div>
    {/if}
    <span class="hint">
      {#if cliStatus?.installed}whisper-server is ready.{:else}
        Download the whisper-server binary from <a href="https://github.com/ggml-org/whisper.cpp/releases" target="_blank" rel="noopener noreferrer">whisper.cpp releases</a>.
        On macOS, you can also install via <code>brew install whisper-cpp</code>.
      {/if}
    </span>
  </div>

  <!-- Server Control Bar -->
  {#if cliStatus?.installed && hasDownloadedModel}
  <div class="field">
    <span class="label">Server</span>
    <div class="whisper-model-row">
      {#if serverStatus?.running}
        <span class="server-status-dot running" title="Running"></span>
        <span class="server-status-text">Running — {serverStatus.model_name ?? 'unknown'} (port {serverStatus.port})</span>
      {:else}
        <span class="server-status-dot stopped" title="Stopped"></span>
        <span class="server-status-text">Stopped</span>
      {/if}
      <div class="server-actions">
        {#if serverStatus?.running}
          <button type="button" class="toggle-btn" onclick={stopServer} disabled={serverStopping}>
            {serverStopping ? 'Stopping…' : 'Stop'}
          </button>
          <button type="button" class="toggle-btn" onclick={restartServer} disabled={serverStarting || serverStopping}>
            {serverStarting ? 'Restarting…' : 'Restart'}
          </button>
        {:else}
          <button type="button" class="toggle-btn" onclick={startServer} disabled={serverStarting}>
            {serverStarting ? 'Starting…' : 'Start'}
          </button>
        {/if}
      </div>
    </div>
    <span class="hint">
      {#if serverStatus?.running}The server stays running across dictation sessions for fast inference. Stop it to free resources or before deleting files.
      {:else}Start the server to pre-load the model for faster dictation startup.
      {/if}
    </span>
  </div>
  {/if}

  <label class="field toggle-field">
    <span class="label">Use GPU</span>
    <div class="toggle-row">
      <input type="checkbox" bind:checked={whisperUseGpu} class="toggle-checkbox"
        disabled={whisperCliVariant === 'cpu' || whisperCliVariant === 'blas'} />
      <span class="toggle-label">{whisperUseGpu ? 'On' : 'Off'}</span>
    </div>
    <span class="hint">
      {#if whisperCliVariant === 'cpu' || whisperCliVariant === 'blas'}
        GPU acceleration requires a CUDA variant. Download a CUDA variant above to enable.
      {:else}
        Enable GPU acceleration via CUDA. Requires a compatible NVIDIA GPU.
      {/if}
    </span>
  </label>

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
            {#if serverStatus?.running && serverStatus.model_name === m.name}
              <span class="whisper-model-badge downloading" title="Stop the server to delete this model">In use</span>
            {:else}
              <button type="button" class="toggle-btn whisper-delete-btn" onclick={() => deleteWhisperModel(m.name)}>Delete</button>
            {/if}
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
