<script lang="ts">
  import { SUPPORTED_LANGUAGES } from "../../../settingsStore";
  import type { AudioDevice } from "../../../speechService";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { EVENT_WHISPER_DOWNLOAD_PROGRESS, EVENT_WHISPER_CLI_DOWNLOAD_PROGRESS, WHISPER_CLI_VARIANTS, WHISPER_DEFAULT_CLI_VERSION } from "../../../constants";
  import { onMount } from "svelte";

  let {
    config = $bindable(),
    audioDevices,
    micWarning,
    microphoneDeviceId = $bindable(),
    isMac = false,
    error = $bindable(),
  }: {
    config: Record<string, unknown>;
    audioDevices: AudioDevice[];
    micWarning: string;
    microphoneDeviceId: string;
    isMac?: boolean;
    error: string;
  } = $props();

  // Typed accessors for config fields
  let whisperModel = $derived(config.model as string ?? "base");
  let whisperLanguage = $derived(config.language as string ?? "en-US");
  let whisperDecodeInterval = $derived(config.decode_interval as number ?? 1);
  let whisperContextOverlap = $derived(config.context_overlap as number ?? 1);
  let whisperUseGpu = $derived(config.use_gpu as boolean ?? false);
  let whisperCliVersion = $derived(config.cli_version as string ?? WHISPER_DEFAULT_CLI_VERSION);
  let whisperCliVariant = $derived(config.cli_variant as string ?? "cpu");

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
  let cliChecking = $state(false);
  let gpuDetecting = $state(false);

  // Server status
  interface ServerStatus {
    running: boolean;
    model_name: string | null;
    port: number | null;
    backend: string | null;
  }
  interface HardwareInfo {
    backend: string;
    n_threads: number | null;
    n_threads_total: number | null;
    accel_features: string[];
  }
  let serverStatus = $state<ServerStatus | null>(null);
  let hardwareInfo = $state<HardwareInfo | null>(null);
  let serverStarting = $state(false);
  let serverStopping = $state(false);

  let hasDownloadedModel = $derived(whisperModels.some(m => m.downloaded));

  let modelRecommendation = $derived.by(() => {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4;
    if (gpuInfo?.has_nvidia) {
      return { maxModel: 'large-v3', hint: `GPU: ${gpuInfo.gpu_name ?? 'NVIDIA'} — recommended up to Large v3` };
    }
    if (gpuInfo?.gpu_name?.includes('Metal')) {
      return { maxModel: 'medium', hint: `${gpuInfo.gpu_name} — recommended up to Medium` };
    }
    if (cores >= 8) {
      return { maxModel: 'small', hint: `CPU (${cores} threads) — recommended up to Small` };
    }
    return { maxModel: 'base', hint: `CPU (${cores} threads) — recommended Tiny or Base` };
  });

  async function refreshWhisperModels() {
    try { whisperModels = await invoke<WhisperModelInfo[]>("whisper_list_models"); }
    catch { whisperModels = []; }
    const currentIsDownloaded = whisperModels.some(m => m.name === whisperModel && m.downloaded);
    if (!currentIsDownloaded) {
      const firstDownloaded = whisperModels.find(m => m.downloaded);
      if (firstDownloaded) config.model = firstDownloaded.name;
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

  onMount(() => {
    refreshWhisperModels();
    refreshCliStatus();
    refreshServerStatus();
  });

  async function refreshServerStatus() {
    try { serverStatus = await invoke<ServerStatus>("whisper_server_status"); }
    catch { serverStatus = null; }
    if (serverStatus?.running) {
      try { hardwareInfo = await invoke<HardwareInfo | null>("whisper_hardware_info"); }
      catch { hardwareInfo = null; }
    } else {
      hardwareInfo = null;
    }
  }

  async function refreshCliStatus() {
    cliChecking = true;
    try { cliStatus = await invoke<CliStatus>("whisper_check_cli"); }
    catch { cliStatus = null; }
    finally { cliChecking = false; }
  }

  async function detectGpu() {
    gpuDetecting = true;
    try {
      gpuInfo = await invoke<GpuInfo>("whisper_detect_gpu");
      if (gpuInfo?.recommended_variant) {
        config.cli_variant = gpuInfo.recommended_variant;
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
      if (whisperCliVariant.startsWith('cuda')) {
        config.use_gpu = true;
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
  <h2>Whisper (Local) Settings</h2>
  <div class="speech-notice">
    <div class="notice-icon" title="Info">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    </div>
    <div class="notice-content">
      <strong>Local Speech Recognition</strong>
      <p>Whisper runs entirely on your device using <a href="https://github.com/ggml-org/whisper.cpp" target="_blank" rel="noopener noreferrer">whisper.cpp</a> via a local whisper-server process. No data is sent to any cloud service. {#if isMac}Install <code>whisper-cpp</code> with Homebrew, then check for it here.{:else}Download the CLI binary and a model below to get started.{/if}</p>
    </div>
  </div>

  {#if !cliStatus?.installed || !hasDownloadedModel}
  <div class="whisper-setup-checklist">
    <strong>Setup required</strong>
    <ul>
      <li class:done={cliStatus?.installed}>{cliStatus?.installed ? '✓' : '①'} {isMac ? 'Install whisper-server with Homebrew' : 'Download the whisper-server binary'}</li>
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
        {#if isMac}
          <button type="button" class="toggle-btn" onclick={refreshCliStatus} disabled={cliChecking}>
            {cliChecking ? 'Checking…' : 'Check Again'}
          </button>
        {/if}
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
    {:else if isMac}
      <div class="whisper-cli-setup">
        <div class="gpu-info">
          <span class="gpu-badge">Install whisper.cpp with <code>brew install whisper-cpp</code>, then use the check button to refresh detection.</span>
        </div>
        <div class="whisper-cli-row">
          <button type="button" class="toggle-btn" onclick={refreshCliStatus} disabled={cliChecking}>
            {cliChecking ? 'Checking…' : 'Check Installed'}
          </button>
        </div>
      </div>
    {:else}
      <div class="whisper-cli-setup">
        <div class="whisper-cli-row">
          <label class="cli-field">
            <span class="cli-label">Version</span>
            <input type="text" value={whisperCliVersion} oninput={(e) => config.cli_version = (e.target as HTMLInputElement).value} style="width: 56px;" />
          </label>
          <label class="cli-field">
            <span class="cli-label">Variant</span>
            <select value={whisperCliVariant} onchange={(e) => config.cli_variant = (e.target as HTMLSelectElement).value}>
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
      {#if cliStatus?.installed}whisper-server is ready.{:else if isMac}
        Install via <code>brew install whisper-cpp</code>, then click Check Installed to detect the Homebrew binary.
      {:else}
        Download the whisper-server binary from <a href="https://github.com/ggml-org/whisper.cpp/releases" target="_blank" rel="noopener noreferrer">whisper.cpp releases</a>.
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
        {#if serverStatus.backend || hardwareInfo}
          <span class="server-backend-badge">
            {hardwareInfo?.backend ?? serverStatus.backend ?? 'CPU'}
            {#if hardwareInfo?.n_threads}({hardwareInfo.n_threads}{hardwareInfo.n_threads_total ? `/${hardwareInfo.n_threads_total}` : ''} threads){/if}
          </span>
        {/if}
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
      <input type="checkbox" checked={whisperUseGpu} onchange={(e) => config.use_gpu = (e.target as HTMLInputElement).checked} class="toggle-checkbox"
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
    <select value={whisperModel} onchange={(e) => config.model = (e.target as HTMLSelectElement).value}>
      {#each whisperModels as m}<option value={m.name} disabled={!m.downloaded}>{m.label}{m.downloaded ? '' : ' (not downloaded)'}</option>{/each}
    </select>
    <span class="hint">Select the Whisper model to use. Larger models are more accurate but slower.</span>
    {#if gpuInfo || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency)}
      <span class="hint model-recommendation">💡 {modelRecommendation.hint}</span>
    {/if}
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
    <select value={whisperLanguage} onchange={(e) => config.language = (e.target as HTMLSelectElement).value}>
      {#each SUPPORTED_LANGUAGES as lang}<option value={lang.code}>{lang.label} ({lang.code})</option>{/each}
    </select>
    <span class="hint">Select the language you will be speaking. This improves transcription speed and accuracy.</span>
  </label>
  <label class="field">
    <span class="label">Decode Interval: {whisperDecodeInterval}s</span>
    <input type="range" min="0.5" max="10" step="0.5" value={whisperDecodeInterval} oninput={(e) => config.decode_interval = parseFloat((e.target as HTMLInputElement).value)} />
    <span class="hint">How often audio is sent to Whisper for transcription. Lower values give faster interim results but use more CPU.</span>
  </label>
  <label class="field">
    <span class="label">Context Overlap: {whisperContextOverlap}s</span>
    <input type="range" min="0" max="3" step="0.5" value={whisperContextOverlap} oninput={(e) => config.context_overlap = parseFloat((e.target as HTMLInputElement).value)} />
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
