<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import {
    type AppSettings,
    DEFAULT_SETTINGS,
    SUPPORTED_LANGUAGES,
    AZURE_REGIONS,
    saveSettings,
  } from "../lib/settingsStore";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { enumerateAudioDevices, checkMicrophonePermission, testAzureConnection, webSpeechAvailable, type AudioDevice } from "../lib/speechService";
  import { getUsageStats, resetUsage, pruneOldEntries, formatDuration, type UsageStats } from "../lib/usageStore";
  import { clearHistory, pruneHistory } from "../lib/historyStore";
  import { getTemplates, addTemplate, updateTemplate, deleteTemplate, type PromptTemplate } from "../lib/templateStore";
  import { copilotInit, copilotAuthStatus, copilotListModels, copilotStop, type CopilotAuthStatus, type CopilotModel } from "../lib/copilotStore";
  import ShortcutRecorder from "./ShortcutRecorder.svelte";
  import { onMount } from "svelte";

  interface Props {
    initialSettings: AppSettings | null;
    onSaved?: () => void;
  }

  let { initialSettings, onSaved }: Props = $props();

  let key = $state("");
  let region = $state(DEFAULT_SETTINGS.azure_region);
  let languages = $state<string[]>([...DEFAULT_SETTINGS.languages]);
  let shortcut = $state(DEFAULT_SETTINGS.shortcut);
  let microphoneDeviceId = $state("");
  let theme = $state(DEFAULT_SETTINGS.theme);
  let speechProvider = $state<"os" | "azure" | "whisper">(DEFAULT_SETTINGS.speech_provider);
  let osLanguage = $state(DEFAULT_SETTINGS.os_language);
  let osAutoRestart = $state(DEFAULT_SETTINGS.os_auto_restart);
  let osMaxRestarts = $state(DEFAULT_SETTINGS.os_max_restarts);
  let saving = $state(false);
  let error = $state("");
  let success = $state(false);
  let showKey = $state(false);
  let langFilter = $state("");
  let audioDevices = $state<AudioDevice[]>([]);
  let micWarning = $state("");
  let apiStatus = $state<"idle" | "checking" | "ok" | "error">("idle");
  let apiError = $state("");
  let phraseList = $state<string[]>([]);
  let newPhrase = $state("");
  let alwaysOnTop = $state(DEFAULT_SETTINGS.always_on_top);
  let autoPunctuation = $state(DEFAULT_SETTINGS.auto_punctuation);
  let autoStartRecording = $state(DEFAULT_SETTINGS.auto_start_recording);
  let autostartEnabled = $state(DEFAULT_SETTINGS.autostart_enabled);
  let silenceTimeoutEnabled = $state(true);
  let silenceTimeoutSeconds = $state(DEFAULT_SETTINGS.silence_timeout_seconds);
  let maxRecordingEnabled = $state(DEFAULT_SETTINGS.max_recording_enabled);
  let maxRecordingSeconds = $state(DEFAULT_SETTINGS.max_recording_seconds);
  let historyEnabled = $state(DEFAULT_SETTINGS.history_enabled);
  let historyMaxEntries = $state(DEFAULT_SETTINGS.history_max_entries);
  let popupCopyShortcut = $state(DEFAULT_SETTINGS.popup_copy_shortcut);
  let popupVoiceShortcut = $state(DEFAULT_SETTINGS.popup_voice_shortcut);
  let providerSwitchShortcut = $state(DEFAULT_SETTINGS.provider_switch_shortcut);

  // Whisper-specific state
  let whisperModel = $state(DEFAULT_SETTINGS.whisper_model);
  let whisperLanguage = $state(DEFAULT_SETTINGS.whisper_language);
  let whisperChunkSeconds = $state(DEFAULT_SETTINGS.whisper_chunk_seconds);

  // Whisper model management
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

  // Sub-tab navigation within Speech tab (independent of selected provider)
  let speechSubTab = $state<"os" | "azure" | "whisper">("os");

  // Detect browser engine
  let browserEngine = $derived.by(() => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'Microsoft Edge (Chromium)';
    if (ua.includes('Chrome/')) return 'Chromium-based (WebView2)';
    if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'WebKit (Safari/WKWebView)';
    if (ua.includes('Firefox/')) return 'Firefox';
    return 'Unknown';
  });

  // Tab navigation
  let activeTab = $state<"general" | "speech" | "phrases" | "templates" | "history" | "usage" | "copilot">("general");

  // Template management
  let templates = $state<PromptTemplate[]>([]);
  let newTemplateName = $state("");
  let newTemplateText = $state("");
  let editingTemplateId = $state<string | null>(null);
  let editTemplateName = $state("");
  let editTemplateText = $state("");
  let deleteConfirmId = $state<string | null>(null);

  // Usage statistics
  let usageStats = $state<UsageStats | null>(null);
  let showResetConfirm = $state(false);
  let showClearHistoryConfirm = $state(false);

  // Copilot state
  let copilotAuth = $state<CopilotAuthStatus | null>(null);
  let copilotModels = $state<CopilotModel[]>([]);
  let copilotLoading = $state(false);
  let copilotError = $state("");
  let copilotInitialized = $state(false);
  let copilotNeedsCli = $state(false);
  let copilotNeedsLogin = $state(false);

  async function checkConnection() {
    if (!key || !region) {
      apiStatus = "error";
      apiError = "Enter a speech key and region first.";
      return;
    }
    apiStatus = "checking";
    apiError = "";
    const result = await testAzureConnection(key, region);
    if (result.ok) {
      apiStatus = "ok";
      apiError = "";
    } else {
      apiStatus = "error";
      apiError = result.error ?? "Connection failed.";
    }
  }

  // Sync local state when initialSettings loads (async prop)
  $effect(() => {
    if (initialSettings) {
      speechProvider = initialSettings.speech_provider ?? DEFAULT_SETTINGS.speech_provider;
      osLanguage = initialSettings.os_language ?? DEFAULT_SETTINGS.os_language;
      osAutoRestart = initialSettings.os_auto_restart ?? DEFAULT_SETTINGS.os_auto_restart;
      osMaxRestarts = initialSettings.os_max_restarts ?? DEFAULT_SETTINGS.os_max_restarts;
      key = initialSettings.azure_speech_key ?? "";
      region = initialSettings.azure_region ?? DEFAULT_SETTINGS.azure_region;
      languages = initialSettings.languages ?? [...DEFAULT_SETTINGS.languages];
      shortcut = initialSettings.shortcut ?? DEFAULT_SETTINGS.shortcut;
      microphoneDeviceId = initialSettings.microphone_device_id ?? "";
      phraseList = initialSettings.phrase_list ? [...initialSettings.phrase_list] : [];
      alwaysOnTop = initialSettings.always_on_top ?? DEFAULT_SETTINGS.always_on_top;
      autoPunctuation = initialSettings.auto_punctuation ?? DEFAULT_SETTINGS.auto_punctuation;
      autoStartRecording = initialSettings.auto_start_recording ?? DEFAULT_SETTINGS.auto_start_recording;
      autostartEnabled = initialSettings.autostart_enabled ?? DEFAULT_SETTINGS.autostart_enabled;
      const savedTimeout = initialSettings.silence_timeout_seconds ?? DEFAULT_SETTINGS.silence_timeout_seconds;
      silenceTimeoutEnabled = savedTimeout > 0;
      silenceTimeoutSeconds = savedTimeout > 0 ? savedTimeout : 30;
      maxRecordingEnabled = initialSettings.max_recording_enabled ?? DEFAULT_SETTINGS.max_recording_enabled;
      maxRecordingSeconds = initialSettings.max_recording_seconds ?? DEFAULT_SETTINGS.max_recording_seconds;
      historyEnabled = initialSettings.history_enabled ?? DEFAULT_SETTINGS.history_enabled;
      historyMaxEntries = initialSettings.history_max_entries ?? DEFAULT_SETTINGS.history_max_entries;
      popupCopyShortcut = initialSettings.popup_copy_shortcut ?? DEFAULT_SETTINGS.popup_copy_shortcut;
      popupVoiceShortcut = initialSettings.popup_voice_shortcut ?? DEFAULT_SETTINGS.popup_voice_shortcut;
      providerSwitchShortcut = initialSettings.provider_switch_shortcut ?? DEFAULT_SETTINGS.provider_switch_shortcut;
      whisperModel = initialSettings.whisper_model ?? DEFAULT_SETTINGS.whisper_model;
      whisperLanguage = initialSettings.whisper_language ?? DEFAULT_SETTINGS.whisper_language;
      whisperChunkSeconds = initialSettings.whisper_chunk_seconds ?? DEFAULT_SETTINGS.whisper_chunk_seconds;
      const savedTheme = initialSettings.theme ?? DEFAULT_SETTINGS.theme;
      theme = savedTheme;
      document.documentElement.dataset.theme = savedTheme;
    }
  });

  // Detect unsaved changes by comparing current form state to saved settings
  let isDirty = $derived.by(() => {
    if (!initialSettings) return false;
    const saved = initialSettings;
    if (speechProvider !== (saved.speech_provider ?? DEFAULT_SETTINGS.speech_provider)) return true;
    if (osLanguage !== (saved.os_language ?? DEFAULT_SETTINGS.os_language)) return true;
    if (osAutoRestart !== (saved.os_auto_restart ?? DEFAULT_SETTINGS.os_auto_restart)) return true;
    if (osMaxRestarts !== (saved.os_max_restarts ?? DEFAULT_SETTINGS.os_max_restarts)) return true;
    if (key !== (saved.azure_speech_key ?? "")) return true;
    if (region !== (saved.azure_region ?? DEFAULT_SETTINGS.azure_region)) return true;
    if (JSON.stringify(languages) !== JSON.stringify(saved.languages ?? DEFAULT_SETTINGS.languages)) return true;
    if (shortcut !== (saved.shortcut ?? DEFAULT_SETTINGS.shortcut)) return true;
    if (microphoneDeviceId !== (saved.microphone_device_id ?? "")) return true;
    if (theme !== (saved.theme ?? DEFAULT_SETTINGS.theme)) return true;
    if (JSON.stringify(phraseList) !== JSON.stringify(saved.phrase_list ?? [])) return true;
    if (alwaysOnTop !== (saved.always_on_top ?? DEFAULT_SETTINGS.always_on_top)) return true;
    if (autoPunctuation !== (saved.auto_punctuation ?? DEFAULT_SETTINGS.auto_punctuation)) return true;
    if (autoStartRecording !== (saved.auto_start_recording ?? DEFAULT_SETTINGS.auto_start_recording)) return true;
    if (autostartEnabled !== (saved.autostart_enabled ?? DEFAULT_SETTINGS.autostart_enabled)) return true;
    const savedTimeout = saved.silence_timeout_seconds ?? DEFAULT_SETTINGS.silence_timeout_seconds;
    const currentTimeout = silenceTimeoutEnabled ? silenceTimeoutSeconds : 0;
    if (currentTimeout !== savedTimeout) return true;
    if (historyEnabled !== (saved.history_enabled ?? DEFAULT_SETTINGS.history_enabled)) return true;
    if (historyMaxEntries !== (saved.history_max_entries ?? DEFAULT_SETTINGS.history_max_entries)) return true;
    if (popupCopyShortcut !== (saved.popup_copy_shortcut ?? DEFAULT_SETTINGS.popup_copy_shortcut)) return true;
    if (popupVoiceShortcut !== (saved.popup_voice_shortcut ?? DEFAULT_SETTINGS.popup_voice_shortcut)) return true;
    if (providerSwitchShortcut !== (saved.provider_switch_shortcut ?? DEFAULT_SETTINGS.provider_switch_shortcut)) return true;
    if (whisperModel !== (saved.whisper_model ?? DEFAULT_SETTINGS.whisper_model)) return true;
    if (whisperLanguage !== (saved.whisper_language ?? DEFAULT_SETTINGS.whisper_language)) return true;
    if (whisperChunkSeconds !== (saved.whisper_chunk_seconds ?? DEFAULT_SETTINGS.whisper_chunk_seconds)) return true;
    if (maxRecordingEnabled !== (saved.max_recording_enabled ?? DEFAULT_SETTINGS.max_recording_enabled)) return true;
    if (maxRecordingSeconds !== (saved.max_recording_seconds ?? DEFAULT_SETTINGS.max_recording_seconds)) return true;
    return false;
  });

  function revertChanges() {
    if (!initialSettings) return;
    const s = initialSettings;
    speechProvider = s.speech_provider ?? DEFAULT_SETTINGS.speech_provider;
    osLanguage = s.os_language ?? DEFAULT_SETTINGS.os_language;
    osAutoRestart = s.os_auto_restart ?? DEFAULT_SETTINGS.os_auto_restart;
    osMaxRestarts = s.os_max_restarts ?? DEFAULT_SETTINGS.os_max_restarts;
    key = s.azure_speech_key ?? "";
    region = s.azure_region ?? DEFAULT_SETTINGS.azure_region;
    languages = s.languages ? [...s.languages] : [...DEFAULT_SETTINGS.languages];
    shortcut = s.shortcut ?? DEFAULT_SETTINGS.shortcut;
    microphoneDeviceId = s.microphone_device_id ?? "";
    phraseList = s.phrase_list ? [...s.phrase_list] : [];
    alwaysOnTop = s.always_on_top ?? DEFAULT_SETTINGS.always_on_top;
    autoPunctuation = s.auto_punctuation ?? DEFAULT_SETTINGS.auto_punctuation;
    autoStartRecording = s.auto_start_recording ?? DEFAULT_SETTINGS.auto_start_recording;
    autostartEnabled = s.autostart_enabled ?? DEFAULT_SETTINGS.autostart_enabled;
    const savedTimeout = s.silence_timeout_seconds ?? DEFAULT_SETTINGS.silence_timeout_seconds;
    silenceTimeoutEnabled = savedTimeout > 0;
    silenceTimeoutSeconds = savedTimeout > 0 ? savedTimeout : 30;
    maxRecordingEnabled = s.max_recording_enabled ?? DEFAULT_SETTINGS.max_recording_enabled;
    maxRecordingSeconds = s.max_recording_seconds ?? DEFAULT_SETTINGS.max_recording_seconds;
    historyEnabled = s.history_enabled ?? DEFAULT_SETTINGS.history_enabled;
    historyMaxEntries = s.history_max_entries ?? DEFAULT_SETTINGS.history_max_entries;
    popupCopyShortcut = s.popup_copy_shortcut ?? DEFAULT_SETTINGS.popup_copy_shortcut;
    popupVoiceShortcut = s.popup_voice_shortcut ?? DEFAULT_SETTINGS.popup_voice_shortcut;
    providerSwitchShortcut = s.provider_switch_shortcut ?? DEFAULT_SETTINGS.provider_switch_shortcut;
    whisperModel = s.whisper_model ?? DEFAULT_SETTINGS.whisper_model;
    whisperLanguage = s.whisper_language ?? DEFAULT_SETTINGS.whisper_language;
    whisperChunkSeconds = s.whisper_chunk_seconds ?? DEFAULT_SETTINGS.whisper_chunk_seconds;
    const savedTheme = s.theme ?? DEFAULT_SETTINGS.theme;
    theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
    error = "";
    success = false;
  }

  onMount(async () => {
    const result = await enumerateAudioDevices();
    audioDevices = result.devices;
    micWarning = result.error ?? "";
    // Load usage stats and prune old entries
    await pruneOldEntries();
    usageStats = await getUsageStats();
    // Load templates
    templates = await getTemplates();
    // Load whisper models
    await refreshWhisperModels();
  });

  async function refreshWhisperModels() {
    try {
      whisperModels = await invoke<WhisperModelInfo[]>("whisper_list_models");
    } catch {
      whisperModels = [];
    }
  }

  async function downloadWhisperModel(name: string) {
    whisperDownloading = name;
    whisperDownloadProgress = 0;
    whisperDownloadTotal = 0;

    const unlisten = await listen<{ model: string; downloaded: number; total: number }>(
      "whisper-download-progress",
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
    } catch (e) {
      error = `Download failed: ${e}`;
    } finally {
      unlisten();
      whisperDownloading = null;
    }
  }

  async function deleteWhisperModel(name: string) {
    try {
      await invoke("whisper_delete_model", { modelName: name });
      await refreshWhisperModels();
    } catch (e) {
      error = `Delete failed: ${e}`;
    }
  }

  async function handleAddTemplate() {
    if (!newTemplateName.trim() || !newTemplateText.trim()) return;
    await addTemplate(newTemplateName, newTemplateText);
    templates = await getTemplates();
    newTemplateName = "";
    newTemplateText = "";
    await emit("templates-updated");
  }

  function startEditTemplate(t: PromptTemplate) {
    editingTemplateId = t.id;
    editTemplateName = t.name;
    editTemplateText = t.text;
    deleteConfirmId = null;
  }

  async function saveEditTemplate() {
    if (!editingTemplateId || !editTemplateName.trim() || !editTemplateText.trim()) return;
    await updateTemplate(editingTemplateId, editTemplateName, editTemplateText);
    templates = await getTemplates();
    editingTemplateId = null;
    editTemplateName = "";
    editTemplateText = "";
    await emit("templates-updated");
  }

  function cancelEditTemplate() {
    editingTemplateId = null;
    editTemplateName = "";
    editTemplateText = "";
  }

  async function handleDeleteTemplate(id: string) {
    await deleteTemplate(id);
    templates = await getTemplates();
    deleteConfirmId = null;
    await emit("templates-updated");
  }

  let filteredLanguages = $derived(
    langFilter
      ? SUPPORTED_LANGUAGES.filter(
          (l) =>
            l.label.toLowerCase().includes(langFilter.toLowerCase()) ||
            l.code.toLowerCase().includes(langFilter.toLowerCase())
        )
      : SUPPORTED_LANGUAGES
  );

  function toggleLanguage(code: string) {
    if (languages.includes(code)) {
      if (languages.length > 1) {
        languages = languages.filter((l) => l !== code);
      }
    } else {
      languages = [...languages, code];
    }
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  }

  function addPhrase() {
    const trimmed = newPhrase.trim();
    if (trimmed && !phraseList.includes(trimmed)) {
      phraseList = [...phraseList, trimmed];
    }
    newPhrase = "";
  }

  function removePhrase(phrase: string) {
    phraseList = phraseList.filter((p) => p !== phrase);
  }

  async function handleSave() {
    saving = true;
    error = "";
    success = false;

    try {
      await saveSettings({
        speech_provider: speechProvider,
        os_language: osLanguage,
        os_auto_restart: osAutoRestart,
        os_max_restarts: osMaxRestarts,
        azure_speech_key: key,
        azure_region: region,
        whisper_model: whisperModel,
        whisper_language: whisperLanguage,
        whisper_chunk_seconds: whisperChunkSeconds,
        languages,
        shortcut,
        microphone_device_id: microphoneDeviceId,
        theme,
        phrase_list: phraseList,
        always_on_top: alwaysOnTop,
        auto_punctuation: autoPunctuation,
        auto_start_recording: autoStartRecording,
        silence_timeout_seconds: silenceTimeoutEnabled ? silenceTimeoutSeconds : 0,
        history_enabled: historyEnabled,
        history_max_entries: historyMaxEntries,
        popup_copy_shortcut: popupCopyShortcut,
        popup_voice_shortcut: popupVoiceShortcut,
        provider_switch_shortcut: providerSwitchShortcut,
        max_recording_enabled: maxRecordingEnabled,
        max_recording_seconds: maxRecordingSeconds,
        autostart_enabled: autostartEnabled,
      });
      success = true;
      onSaved?.();
      // Notify other windows
      await emit("settings-updated");
      setTimeout(() => (success = false), 2000);
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="settings-container">
  <div class="settings-header">
    <div class="header">
      <h1>Settings</h1>
      <button
        type="button"
        class="theme-toggle"
        onclick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if theme === 'dark'}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        {/if}
      </button>
    </div>

    <div class="tab-bar">
      <button type="button" class="tab" class:active={activeTab === 'general'} onclick={() => activeTab = 'general'}>General</button>
      <button type="button" class="tab" class:active={activeTab === 'speech'} onclick={() => activeTab = 'speech'}>Speech</button>
      <button type="button" class="tab" class:active={activeTab === 'phrases'} onclick={() => activeTab = 'phrases'}>Phrases</button>
      <button type="button" class="tab" class:active={activeTab === 'templates'} onclick={() => activeTab = 'templates'}>Templates</button>
      <button type="button" class="tab" class:active={activeTab === 'history'} onclick={() => activeTab = 'history'}>History</button>
      <button type="button" class="tab" class:active={activeTab === 'usage'} onclick={() => activeTab = 'usage'}>Usage</button>
      <button type="button" class="tab" class:active={activeTab === 'copilot'} onclick={() => activeTab = 'copilot'}>GitHub Copilot</button>
    </div>
  </div>

  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="settings-body">

    {#if activeTab === 'speech'}
    <div class="section">
      <h2>Speech Provider</h2>
      <label class="field">
        <span class="label">Default Speech Provider</span>
        <select bind:value={speechProvider}>
          <option value="os">Web Speech</option>
          <option value="azure">Azure Speech</option>
          <option value="whisper">Whisper (Local)</option>
        </select>
        <span class="hint">Choose which speech engine is used by default when recording.</span>
      </label>
    </div>

    <div class="speech-sub-tabs">
      <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'os'} onclick={() => speechSubTab = 'os'}>
        Web Speech
        {#if !webSpeechAvailable}<span class="sub-tab-warn">!</span>{/if}
      </button>
      <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'azure'} onclick={() => speechSubTab = 'azure'}>
        Azure Speech
      </button>
      <button type="button" class="speech-sub-tab" class:active={speechSubTab === 'whisper'} onclick={() => speechSubTab = 'whisper'}>
        Whisper (Local)
      </button>
    </div>

    {#if speechSubTab === 'os'}
    <div class="section">
      <h2>Web Speech Settings</h2>
      {#if !webSpeechAvailable}
        <div class="provider-warn-banner">Web Speech API is not available in this browser environment.</div>
      {/if}

      <div class="speech-notice">
        <div class="notice-icon" title="Info">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>
        <div class="notice-content">
          <strong>Speech Recognition Notice</strong>
          <p>
            Web Speech uses your browser's built-in speech recognition engine.
            Depending on the browser, audio may be sent to a cloud service for processing.
          </p>
          <p class="browser-info">
            <span class="browser-badge">{browserEngine}</span>
          </p>
          <p>
            For details, see the
            <!-- svelte-ignore a11y_missing_attribute -->
            <a
              href="https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API"
              target="_blank"
              rel="noopener noreferrer"
              class="notice-link"
            >MDN Web Speech API documentation</a>.
          </p>
        </div>
      </div>

      <label class="field">
        <span class="label">Language</span>
        <select bind:value={osLanguage}>
          {#each SUPPORTED_LANGUAGES as lang}
            <option value={lang.code}>{lang.label} ({lang.code})</option>
          {/each}
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
        <input
          type="number"
          min="1"
          max="20"
          bind:value={osMaxRestarts}
          style="width: 80px;"
        />
        <span class="hint">Maximum consecutive auto-restarts before giving up (1–20).</span>
      </label>
      {/if}

      <label class="field">
        <span class="label">Microphone</span>
        <select bind:value={microphoneDeviceId}>
          <option value="">System Default</option>
          {#each audioDevices as device}
            <option value={device.deviceId}>{device.label}</option>
          {/each}
        </select>
        {#if micWarning}
          <span class="hint mic-warning">{micWarning}</span>
        {:else}
          <span class="hint">Select the microphone to use for dictation.</span>
        {/if}
      </label>
    </div>
    {/if}

    {#if speechSubTab === 'azure'}
    <div class="section">
      <h2>Azure Speech Service</h2>

      <label class="field">
        <span class="label">Speech Key</span>
        <div class="input-row">
          <input
            type={showKey ? "text" : "password"}
            bind:value={key}
            placeholder="Enter your Azure Speech key"
            autocomplete="off"
          />
          <button
            type="button"
            class="toggle-btn"
            onclick={() => (showKey = !showKey)}
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
      </label>

      <label class="field">
        <span class="label">Region</span>
        <select bind:value={region}>
          {#each AZURE_REGIONS as r}
            <option value={r.value}>{r.label} ({r.value})</option>
          {/each}
        </select>
      </label>

      <div class="field">
        <span class="label">Connection Status</span>
        <div class="connection-row">
          <button
            type="button"
            class="test-btn"
            onclick={checkConnection}
            disabled={apiStatus === 'checking'}
          >
            {apiStatus === 'checking' ? 'Checking...' : 'Test Connection'}
          </button>
          <span
            class="status-dot"
            class:dot-ok={apiStatus === 'ok'}
            class:dot-error={apiStatus === 'error'}
            class:dot-checking={apiStatus === 'checking'}
            title={apiStatus === 'ok' ? 'Connected' : apiStatus === 'error' ? apiError : apiStatus === 'checking' ? 'Checking...' : 'Not tested'}
          ></span>
          {#if apiStatus === 'ok'}
            <span class="connection-text ok">Connected</span>
          {:else if apiStatus === 'error'}
            <span class="connection-text err" title={apiError}>{apiError}</span>
          {/if}
        </div>
      </div>

      <div class="field">
        <span class="label">Languages ({languages.length} selected)</span>
        <input
          type="text"
          bind:value={langFilter}
          placeholder="Filter languages..."
          class="lang-filter"
        />
        <div class="lang-list">
          {#each filteredLanguages as lang}
            <label class="lang-item">
              <input
                type="checkbox"
                checked={languages.includes(lang.code)}
                onchange={() => toggleLanguage(lang.code)}
              />
              <span>{lang.label}</span>
              <span class="lang-code">{lang.code}</span>
            </label>
          {/each}
        </div>
        <span class="hint">Select one or more. Multiple languages enable auto-detection.</span>
      </div>

      <label class="field">
        <span class="label">Microphone</span>
        <select bind:value={microphoneDeviceId}>
          <option value="">System Default</option>
          {#each audioDevices as device}
            <option value={device.deviceId}>{device.label}</option>
          {/each}
        </select>
        {#if micWarning}
          <span class="hint mic-warning">{micWarning}</span>
        {:else}
          <span class="hint">Select the microphone to use for dictation.</span>
        {/if}
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

    {#if speechSubTab === 'whisper'}
    <div class="section">
      <h2>Whisper (Local) Settings</h2>

      <div class="speech-notice">
        <div class="notice-icon" title="Info">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
        </div>
        <div class="notice-content">
          <strong>Local Speech Recognition</strong>
          <p>
            Whisper runs entirely on your device using <a href="https://github.com/ggerganov/whisper.cpp" target="_blank" rel="noopener noreferrer">whisper.cpp</a> via <a href="https://github.com/tazz4843/whisper-rs" target="_blank" rel="noopener noreferrer">whisper-rs</a>. No data is sent to any cloud service.
            Download a model below to get started. Larger models are more accurate but use more RAM and are slower.
          </p>
        </div>
      </div>

      <div class="field">
        <span class="label">Model</span>
        <select bind:value={whisperModel}>
          {#each whisperModels as m}
            <option value={m.name} disabled={!m.downloaded}>{m.label}{m.downloaded ? '' : ' (not downloaded)'}</option>
          {/each}
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
                  {#if whisperDownloadTotal > 0}
                    {Math.round(whisperDownloadProgress / whisperDownloadTotal * 100)}%
                  {:else}
                    Downloading...
                  {/if}
                </span>
              {:else}
                <button type="button" class="toggle-btn" onclick={() => downloadWhisperModel(m.name)} disabled={whisperDownloading !== null}>
                  Download ({m.size_mb} MB)
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <label class="field">
        <span class="label">Language</span>
        <select bind:value={whisperLanguage}>
          {#each SUPPORTED_LANGUAGES as lang}
            <option value={lang.code}>{lang.label} ({lang.code})</option>
          {/each}
        </select>
        <span class="hint">Select the language you will be speaking. This improves transcription speed and accuracy.</span>
      </label>

      <label class="field">
        <span class="label">Chunk Duration: {whisperChunkSeconds}s</span>
        <input
          type="range"
          min="3"
          max="15"
          step="1"
          bind:value={whisperChunkSeconds}
        />
        <span class="hint">Audio is buffered in chunks and sent to Whisper for transcription. Shorter chunks give faster feedback; longer chunks may be more accurate.</span>
      </label>

      <label class="field">
        <span class="label">Microphone</span>
        <select bind:value={microphoneDeviceId}>
          <option value="">System Default</option>
          {#each audioDevices as device}
            <option value={device.deviceId}>{device.label}</option>
          {/each}
        </select>
        {#if micWarning}
          <span class="hint mic-warning">{micWarning}</span>
        {:else}
          <span class="hint">Select the microphone to use for dictation.</span>
        {/if}
      </label>
    </div>
    {/if}
    {/if}

    {#if activeTab === 'phrases'}
    <div class="section">
      <h2>Phrase List</h2>
      <p class="section-note">Phrase lists improve recognition accuracy for <strong>Azure Speech</strong> (boost) and <strong>Whisper</strong> (initial prompt). They are not used with Web Speech.</p>

      <div class="field">
        <span class="label">Custom Phrases ({phraseList.length})</span>
        <div class="input-row">
          <input
            type="text"
            bind:value={newPhrase}
            placeholder="Add a word or phrase..."
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhrase(); } }}
          />
          <button type="button" class="toggle-btn" onclick={addPhrase}>Add</button>
        </div>
        {#if phraseList.length > 0}
          <div class="phrase-tags">
            {#each phraseList as phrase}
              <span class="phrase-tag">
                {phrase}
                <button type="button" class="phrase-remove" onclick={() => removePhrase(phrase)}>✕</button>
              </span>
            {/each}
          </div>
        {/if}
        <span class="hint">Add words or phrases to improve recognition accuracy (e.g. technical terms, names, project-specific vocabulary).</span>
      </div>
    </div>
    {/if}

    {#if activeTab === 'general'}
    <div class="section">
      <h2>General</h2>

      <div class="field">
        <span class="label">Theme</span>
        <div class="toggle-row">
          <button
            type="button"
            class="theme-toggle-inline"
            onclick={toggleTheme}
          >
            {#if theme === 'dark'}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              Light Mode
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              Dark Mode
            {/if}
          </button>
        </div>
        <span class="hint">Switch between dark and light theme.</span>
      </div>

    <div class="section">
      <h2>Behavior</h2>

      <label class="field toggle-field">
        <span class="label">Start on Login</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={autostartEnabled} class="toggle-checkbox" />
          <span class="toggle-label">{autostartEnabled ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Automatically start the app when you log in to your computer.</span>
      </label>

      <div class="field">
        <span class="label">Global Shortcut</span>
        <ShortcutRecorder bind:value={shortcut} />
        <span class="hint">
          {#if shortcut}
            Click "Record" to change, or "✕" to disable the shortcut
          {:else}
            No shortcut set. Click "Record" to assign one.
          {/if}
        </span>
      </div>

      <div class="field">
        <span class="label">Popup Copy & Close Shortcut</span>
        <ShortcutRecorder bind:value={popupCopyShortcut} />
        <span class="hint">
          {#if popupCopyShortcut}
            Keyboard shortcut to copy text and close the popup.
          {:else}
            No shortcut set. Click "Record" to assign one.
          {/if}
        </span>
      </div>

      <div class="field">
        <span class="label">Voice Toggle Shortcut</span>
        <ShortcutRecorder bind:value={popupVoiceShortcut} />
        <span class="hint">
          {#if popupVoiceShortcut}
            Keyboard shortcut to start/stop voice recording in the popup.
          {:else}
            No shortcut set. Click "Record" to assign one.
          {/if}
        </span>
      </div>

      <div class="field">
        <span class="label">Speech Provider Switch Shortcut</span>
        <ShortcutRecorder bind:value={providerSwitchShortcut} />
        <span class="hint">
          {#if providerSwitchShortcut}
            Keyboard shortcut to cycle between Web Speech, Azure, and Whisper providers.
          {:else}
            No shortcut set. Click "Record" to assign one.
          {/if}
        </span>
      </div>

      <label class="field toggle-field">
        <span class="label">Always on Top</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={alwaysOnTop} class="toggle-checkbox" />
          <span class="toggle-label">{alwaysOnTop ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Keep the dictation popup above other windows.</span>
      </label>

      <label class="field toggle-field">
        <span class="label">Auto-Start Recording</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={autoStartRecording} class="toggle-checkbox" />
          <span class="toggle-label">{autoStartRecording ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Automatically start recording when the popup opens.</span>
      </label>

      <div class="field">
        <label class="toggle-field">
          <span class="label">Silence Auto-Stop</span>
          <div class="toggle-row">
            <input type="checkbox" bind:checked={silenceTimeoutEnabled} class="toggle-checkbox" />
            <span class="toggle-label">{silenceTimeoutEnabled ? 'On' : 'Off'}</span>
          </div>
        </label>
        {#if silenceTimeoutEnabled}
          <div class="input-row" style="margin-top: 6px;">
            <input
              type="number"
              min="10"
              max="300"
              bind:value={silenceTimeoutSeconds}
              style="width: 80px;"
            />
            <span class="timeout-unit">seconds</span>
          </div>
        {/if}
        <span class="hint">Automatically stop recording after this many seconds of silence to save costs. Set 10–300 seconds, or disable.</span>
      </div>

      <div class="field">
        <label class="toggle-field">
          <span class="label">Max Recording Time</span>
          <div class="toggle-row">
            <input type="checkbox" bind:checked={maxRecordingEnabled} class="toggle-checkbox" />
            <span class="toggle-label">{maxRecordingEnabled ? 'On' : 'Off'}</span>
          </div>
        </label>
        {#if maxRecordingEnabled}
          <div class="input-row" style="margin-top: 6px;">
            <input
              type="number"
              min="30"
              max="600"
              bind:value={maxRecordingSeconds}
              style="width: 80px;"
            />
            <span class="timeout-unit">seconds</span>
          </div>
        {/if}
        <span class="hint">Safety limit to prevent accidental long recordings. Automatically stops after this duration regardless of speech activity. Default 180 seconds (3 minutes).</span>
      </div>
    </div>
    </div>
    {/if}

    {#if activeTab === 'templates'}
    <div class="section">
      <h2>Prompt Templates</h2>
      <p class="section-note">Create reusable text templates. You can also save templates from the popup text area.</p>

      <div class="field">
        <span class="label">New Template</span>
        <input
          type="text"
          bind:value={newTemplateName}
          placeholder="Template name..."
          onkeydown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        />
        <textarea
          class="template-textarea"
          bind:value={newTemplateText}
          placeholder="Template text..."
          rows="3"
        ></textarea>
        <div class="input-row">
          <button type="button" class="toggle-btn" onclick={handleAddTemplate} disabled={!newTemplateName.trim() || !newTemplateText.trim()}>Add Template</button>
        </div>
      </div>

      {#if templates.length === 0}
        <div class="template-empty">No templates yet. Create one above or save text from the popup.</div>
      {:else}
        <div class="template-list">
          {#each templates as t (t.id)}
            <div class="template-item">
              {#if editingTemplateId === t.id}
                <div class="template-edit">
                  <input
                    type="text"
                    bind:value={editTemplateName}
                    placeholder="Template name..."
                  />
                  <textarea
                    class="template-textarea"
                    bind:value={editTemplateText}
                    placeholder="Template text..."
                    rows="3"
                  ></textarea>
                  <div class="template-edit-actions">
                    <button type="button" class="toggle-btn" onclick={saveEditTemplate} disabled={!editTemplateName.trim() || !editTemplateText.trim()}>Save</button>
                    <button type="button" class="toggle-btn" onclick={cancelEditTemplate}>Cancel</button>
                  </div>
                </div>
              {:else}
                <div class="template-body">
                  <span class="template-name">{t.name}</span>
                  <span class="template-preview">{t.text.length > 120 ? t.text.slice(0, 120) + '…' : t.text}</span>
                </div>
                <div class="template-actions">
                  <button type="button" class="template-action-btn" onclick={() => startEditTemplate(t)} title="Edit">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  {#if deleteConfirmId === t.id}
                    <button type="button" class="template-action-btn delete-confirm" onclick={() => handleDeleteTemplate(t.id)} title="Confirm delete">Yes</button>
                    <button type="button" class="template-action-btn" onclick={() => deleteConfirmId = null} title="Cancel">No</button>
                  {:else}
                    <button type="button" class="template-action-btn delete" onclick={() => deleteConfirmId = t.id} title="Delete">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {/if}

    {#if activeTab === 'history'}
    <div class="section">
      <h2>History</h2>

      <label class="field toggle-field">
        <span class="label">Enable History</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={historyEnabled} class="toggle-checkbox" />
          <span class="toggle-label">{historyEnabled ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Save transcription history for later reference.</span>
      </label>

      <label class="field">
        <span class="label">Maximum Entries</span>
        <input
          type="number"
          min="1"
          max="500"
          bind:value={historyMaxEntries}
          disabled={!historyEnabled}
          style="width: 100px;"
        />
        <span class="hint">Oldest entries are removed when the limit is reached (1–500).</span>
      </label>

      <div class="field">
        <span class="label">Clear History</span>
        {#if showClearHistoryConfirm}
          <div class="usage-actions">
            <span class="reset-confirm-text">Delete all history entries?</span>
            <button type="button" class="toggle-btn reset-yes" onclick={async () => { await clearHistory(); showClearHistoryConfirm = false; }}>Yes, clear</button>
            <button type="button" class="toggle-btn" onclick={() => (showClearHistoryConfirm = false)}>Cancel</button>
          </div>
        {:else}
          <div class="usage-actions">
            <button type="button" class="toggle-btn" onclick={() => (showClearHistoryConfirm = true)}>Clear All History</button>
          </div>
        {/if}
        <span class="hint">Permanently remove all saved transcription history.</span>
      </div>
    </div>
    {/if}

    {#if activeTab === 'usage'}
    <div class="section">
      <h2>Usage Statistics</h2>
      {#if usageStats}
        <div class="usage-provider-group">
          <h3 class="usage-provider-title">Total</h3>
          <div class="usage-grid">
            <div class="usage-card">
              <span class="usage-label">Today</span>
              <span class="usage-value">{formatDuration(usageStats.total.today)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">This Week</span>
              <span class="usage-value">{formatDuration(usageStats.total.thisWeek)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">Last 30 Days</span>
              <span class="usage-value">{formatDuration(usageStats.total.last30Days)}</span>
            </div>
          </div>
        </div>

        <div class="usage-provider-group">
          <h3 class="usage-provider-title">Web Speech</h3>
          <div class="usage-grid">
            <div class="usage-card">
              <span class="usage-label">Today</span>
              <span class="usage-value">{formatDuration(usageStats.web.today)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">This Week</span>
              <span class="usage-value">{formatDuration(usageStats.web.thisWeek)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">Last 30 Days</span>
              <span class="usage-value">{formatDuration(usageStats.web.last30Days)}</span>
            </div>
          </div>
        </div>

        <div class="usage-provider-group">
          <h3 class="usage-provider-title">Azure Speech</h3>
          <div class="usage-grid">
            <div class="usage-card">
              <span class="usage-label">Today</span>
              <span class="usage-value">{formatDuration(usageStats.azure.today)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">This Week</span>
              <span class="usage-value">{formatDuration(usageStats.azure.thisWeek)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">Last 30 Days</span>
              <span class="usage-value">{formatDuration(usageStats.azure.last30Days)}</span>
            </div>
          </div>
        </div>

        <div class="usage-provider-group">
          <h3 class="usage-provider-title">Whisper (Local)</h3>
          <div class="usage-grid">
            <div class="usage-card">
              <span class="usage-label">Today</span>
              <span class="usage-value">{formatDuration(usageStats.whisper.today)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">This Week</span>
              <span class="usage-value">{formatDuration(usageStats.whisper.thisWeek)}</span>
            </div>
            <div class="usage-card">
              <span class="usage-label">Last 30 Days</span>
              <span class="usage-value">{formatDuration(usageStats.whisper.last30Days)}</span>
            </div>
          </div>
        </div>

        <div class="usage-actions">
          {#if showResetConfirm}
            <span class="reset-confirm-text">Reset all usage data?</span>
            <button type="button" class="toggle-btn reset-yes" onclick={async () => { await resetUsage(); usageStats = await getUsageStats(); showResetConfirm = false; }}>Yes, reset</button>
            <button type="button" class="toggle-btn" onclick={() => (showResetConfirm = false)}>Cancel</button>
          {:else}
            <button type="button" class="toggle-btn" onclick={() => (showResetConfirm = true)}>Reset Statistics</button>
            <button type="button" class="toggle-btn" onclick={async () => { usageStats = await getUsageStats(); }}>Refresh</button>
          {/if}
        </div>
      {:else}
        <p class="hint">Loading usage data...</p>
      {/if}
    </div>
    {/if}

    {#if activeTab === 'copilot'}
    <div class="section">
      <h2>GitHub Copilot</h2>
      <p class="hint">Optimize your voice transcriptions into better prompts using GitHub Copilot.</p>

      {#if copilotError}
        <div class="message error" style="margin-bottom: 12px;">{copilotError}</div>
      {/if}

      {#if copilotLoading}
        <p class="hint">Connecting...</p>
      {:else if copilotNeedsCli}
        <!-- SDK init failed — CLI likely not installed -->
        <div class="info-box">
          <strong>GitHub Copilot CLI not found</strong>
          <p style="margin-top: 8px;">The GitHub Copilot CLI is required to use this feature. To install it:</p>
          <ol style="margin: 8px 0 0 20px; line-height: 1.8;">
            <li>Run <code>winget install GitHub.Copilot</code> (Windows) or see <a href="https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/installing-github-copilot-in-the-cli" target="_blank" rel="noopener">install docs</a></li>
            <li>Restart your terminal so <code>copilot</code> is on your PATH</li>
            <li>Come back here and click <strong>Retry</strong></li>
          </ol>
        </div>
        <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={() => {
          copilotNeedsCli = false;
          copilotError = '';
        }}>Retry</button>
      {:else if copilotNeedsLogin}
        <!-- SDK running but not logged in -->
        <div class="info-box">
          <strong>Not signed in to GitHub Copilot</strong>
          <p style="margin-top: 8px;">You need to authenticate with GitHub. Open a terminal and run:</p>
          <pre style="margin: 8px 0; padding: 8px 12px; background: var(--bg-primary); border-radius: 6px; font-size: 0.9em;">copilot auth login</pre>
          <p>Follow the prompts to sign in with your GitHub account, then click <strong>Retry</strong> below.</p>
        </div>
        <button type="button" class="toggle-btn" style="margin-top: 12px;" onclick={async () => {
          copilotLoading = true;
          copilotError = '';
          copilotNeedsLogin = false;
          try {
            copilotAuth = await copilotAuthStatus();
            if (copilotAuth?.authenticated) {
              copilotModels = await copilotListModels();
            } else {
              copilotNeedsLogin = true;
            }
          } catch (e: any) {
            copilotError = String(e);
            copilotNeedsLogin = true;
          } finally {
            copilotLoading = false;
          }
        }}>Retry</button>
      {:else if !copilotInitialized}
        <!-- Not connected yet -->
        <button type="button" class="toggle-btn" onclick={async () => {
          copilotLoading = true;
          copilotError = '';
          copilotNeedsCli = false;
          copilotNeedsLogin = false;
          try {
            await copilotInit();
            copilotInitialized = true;
            copilotAuth = await copilotAuthStatus();
            if (copilotAuth?.authenticated) {
              copilotModels = await copilotListModels();
            } else {
              copilotNeedsLogin = true;
            }
          } catch (e: any) {
            copilotInitialized = false;
            const msg = String(e);
            const msgLower = msg.toLowerCase();
            if (msgLower.includes('not found') || msgLower.includes('no such file') || msgLower.includes('os error 2') || msgLower.includes('program not found')) {
              copilotNeedsCli = true;
            } else {
              copilotError = msg;
            }
          } finally {
            copilotLoading = false;
          }
        }}>Connect to GitHub Copilot</button>
      {:else}
        <!-- Authenticated -->
        <div class="info-box" style="border-color: var(--accent-primary); display: flex; align-items: center; gap: 12px;">
          {#if copilotAuth?.login}
            <img
              src="https://github.com/{copilotAuth.login}.png?size=80"
              alt="{copilotAuth.login}"
              style="width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;"
            />
          {/if}
          <p>Signed in as <strong>{copilotAuth?.login ?? 'unknown'}</strong></p>
        </div>

        {#if copilotModels.length > 0}
          <h3 style="margin-top: 16px; margin-bottom: 8px;">Available Models</h3>
          <div class="model-list">
            {#each copilotModels as model}
              <div class="model-card">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong>{model.name}</strong>
                  {#if model.is_premium}
                    <span class="multiplier-badge" class:multiplier-high={model.multiplier > 1} class:multiplier-low={model.multiplier < 1}>
                      {model.multiplier}x
                    </span>
                  {:else}
                    <span class="multiplier-badge multiplier-free">Included</span>
                  {/if}
                </div>
                <span class="hint">{model.id}</span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="hint" style="margin-top: 12px;">No models available.</p>
        {/if}

        <div style="margin-top: 16px; display: flex; gap: 8px;">
          <button type="button" class="toggle-btn" onclick={async () => {
            copilotLoading = true;
            copilotError = '';
            try {
              copilotModels = await copilotListModels();
            } catch (e: any) {
              copilotError = String(e);
            } finally {
              copilotLoading = false;
            }
          }}>Refresh Models</button>
          <button type="button" class="toggle-btn" onclick={async () => {
            copilotLoading = true;
            try {
              await copilotStop();
              copilotInitialized = false;
              copilotAuth = null;
              copilotModels = [];
              copilotNeedsLogin = false;
            } catch (e: any) {
              copilotError = String(e);
            } finally {
              copilotLoading = false;
            }
          }}>Disconnect</button>
        </div>
      {/if}
    </div>
    {/if}

    </div><!-- end .settings-body -->

    {#if error}
      <div class="message error">{error}</div>
    {/if}
    {#if success}
      <div class="message success">Settings saved!</div>
    {/if}

    <div class="footer" class:has-changes={isDirty}>
      {#if isDirty}
        <span class="unsaved-label">Unsaved changes</span>
        <button type="button" class="btn btn-discard" onclick={revertChanges}>
          Discard
        </button>
      {/if}
      <button type="submit" class="btn btn-primary" disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  </form>
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
  }

  .settings-header {
    flex-shrink: 0;
    padding: 20px 24px 0;
  }

  form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0 24px;
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 0 8px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  .tab-bar {
    display: flex;
    gap: 2px;
    margin-bottom: 0;
    background: var(--bg-secondary);
    border-radius: 8px;
    padding: 3px;
    border: 1px solid var(--border);
  }

  .tab {
    flex: 1;
    padding: 7px 0;
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .tab:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .tab.active {
    background: var(--accent);
    color: var(--bg-primary);
    font-weight: 600;
  }

  h2 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-note {
    font-size: 12px;
    color: var(--text-secondary);
    margin: -4px 0 12px 0;
  }

  .theme-toggle {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .theme-toggle:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .speech-sub-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .speech-sub-tab {
    flex: 1;
    padding: 8px 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .speech-sub-tab:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .speech-sub-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .sub-tab-warn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--error);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
  }

  .provider-warn-banner {
    padding: 8px 12px;
    margin-bottom: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--error) 12%, transparent);
    color: var(--error);
    font-size: 12px;
    font-weight: 500;
  }

  .speech-notice {
    display: flex;
    gap: 12px;
    padding: 12px 14px;
    margin-bottom: 14px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--primary) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
    border-left: 3px solid var(--primary);
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .notice-icon {
    flex-shrink: 0;
    color: var(--primary);
    margin-top: 1px;
    opacity: 0.85;
  }

  .notice-content {
    flex: 1;
    min-width: 0;
  }

  .notice-content strong {
    color: var(--text);
    font-size: 12px;
    display: block;
    margin-bottom: 4px;
  }

  .notice-content p {
    margin: 4px 0 0;
  }

  .browser-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--primary) 14%, transparent);
    color: var(--text);
    font-size: 11px;
    font-weight: 500;
  }

  .notice-link {
    color: var(--primary);
    text-decoration: none;
    font-weight: 500;
    border-bottom: 1px dashed color-mix(in srgb, var(--primary) 50%, transparent);
    transition: border-color 0.15s;
  }

  .notice-link:hover {
    border-bottom-style: solid;
    border-bottom-color: var(--primary);
  }

  .theme-toggle-inline {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-hover);
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.2s;
  }

  .theme-toggle-inline:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .section {
    background: var(--bg-secondary);
    padding: 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }

  .field:last-child {
    margin-bottom: 0;
  }

  .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .input-row {
    display: flex;
    gap: 6px;
  }

  .input-row input {
    flex: 1;
  }

  .toggle-btn {
    padding: 6px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-hover);
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }

  .toggle-btn:hover {
    background: var(--surface-hover);
  }

  .connection-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .test-btn {
    padding: 6px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-hover);
    color: var(--text-secondary);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }

  .test-btn:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
  }

  .dot-ok {
    background: var(--success, #a6e3a1);
    box-shadow: 0 0 6px var(--success, #a6e3a1);
  }

  .dot-error {
    background: var(--error, #f38ba8);
    box-shadow: 0 0 6px var(--error, #f38ba8);
  }

  .dot-checking {
    background: var(--warning, #f9e2af);
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .connection-text {
    font-size: 12px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-text.ok {
    color: var(--success, #a6e3a1);
  }

  .connection-text.err {
    color: var(--error, #f38ba8);
  }

  input,
  select {
    width: 100%;
    padding: 8px 10px;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }

  input:focus,
  select:focus {
    border-color: var(--accent);
  }

  select {
    cursor: pointer;
  }

  select option {
    background: var(--input-bg);
    color: var(--text-primary);
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .mic-warning {
    color: var(--error, #e74c3c);
    font-weight: 500;
  }

  .message {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
  }

  .message.error {
    background: var(--error-bg);
    color: var(--error);
    border: 1px solid var(--error-border);
  }

  .message.success {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid var(--success-border);
  }

  .footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    border-top: 1px solid var(--border);
    transition: border-color 0.2s, background 0.2s;
  }

  .footer.has-changes {
    border-top-color: var(--warning);
    padding: 10px 12px;
    margin: 0 -12px;
    border-radius: 0;
    background: var(--warning-bg);
  }

  .unsaved-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--warning);
    margin-right: auto;
  }

  .btn-discard {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .btn-discard:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .btn {
    padding: 8px 20px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .lang-filter {
    margin-bottom: 6px;
  }

  .lang-list {
    max-height: 160px;
    overflow-y: auto;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px;
  }

  .lang-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .lang-item:hover {
    background: var(--bg-primary);
  }

  .lang-item input[type="checkbox"] {
    width: auto;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .lang-code {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
  }

  .phrase-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .phrase-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--lang-tag-bg);
    color: var(--accent);
    border: 1px solid var(--lang-tag-border);
    border-radius: 4px;
    font-size: 12px;
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
  }

  .phrase-remove {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    line-height: 1;
  }

  .phrase-remove:hover {
    color: var(--error);
  }

  .toggle-field {
    cursor: pointer;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .toggle-checkbox {
    width: auto;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .toggle-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .timeout-unit {
    font-size: 13px;
    color: var(--text-secondary);
    align-self: center;
  }

  .usage-provider-group {
    margin-bottom: 14px;
  }

  .usage-provider-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .usage-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    margin-bottom: 8px;
  }

  .usage-card {
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .usage-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .usage-value {
    font-size: 18px;
    font-weight: 600;
    color: var(--accent);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
  }

  .usage-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .reset-confirm-text {
    font-size: 12px;
    color: var(--error);
  }

  .reset-yes {
    color: var(--error);
    border-color: var(--error);
  }

  .reset-yes:hover {
    background: var(--error-bg);
  }

  /* ---- Templates ---- */
  .template-textarea {
    width: 100%;
    padding: 8px 10px;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    outline: none;
    line-height: 1.5;
    min-height: 60px;
  }

  .template-textarea:focus {
    border-color: var(--accent);
  }

  .template-empty {
    padding: 20px 12px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
  }

  .template-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  }

  .template-item {
    display: flex;
    align-items: stretch;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: border-color 0.15s;
  }

  .template-item:hover {
    border-color: var(--accent);
  }

  .template-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    min-width: 0;
  }

  .template-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .template-preview {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    word-break: break-word;
  }

  .template-actions {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 6px 8px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .template-item:hover .template-actions {
    opacity: 1;
  }

  .template-action-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
  }

  .template-action-btn:hover {
    background: var(--surface-hover);
    color: var(--accent);
  }

  .template-action-btn.delete:hover {
    color: var(--error);
  }

  .template-action-btn.delete-confirm {
    color: var(--error);
    font-weight: 600;
  }

  .template-edit {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
  }

  .template-edit-actions {
    display: flex;
    gap: 6px;
  }

  /* Whisper model management */
  .whisper-model-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .whisper-model-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--bg-secondary, #1e1e1e);
  }

  .whisper-model-name {
    flex: 1;
    font-size: 0.92em;
  }

  .whisper-model-badge {
    font-size: 0.8em;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .whisper-model-badge.downloaded {
    background: rgba(72, 199, 142, 0.15);
    color: #48c78e;
  }

  .whisper-model-badge.downloading {
    background: rgba(62, 142, 208, 0.15);
    color: #3e8ed0;
  }

  .whisper-delete-btn {
    color: var(--error, #f56c6c) !important;
    border-color: var(--error, #f56c6c) !important;
  }

  .whisper-delete-btn:hover {
    background: rgba(245, 108, 108, 0.1);
  }

  /* Copilot tab styles */
  .info-box {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, #333);
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 8px;
  }

  .info-box p {
    margin: 4px 0;
  }

  .model-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .model-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, #333);
  }

  .model-card strong {
    font-size: 0.92em;
  }

  .multiplier-badge {
    font-size: 0.78em;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color, #333);
  }

  .multiplier-high {
    color: #e8a040;
    border-color: #e8a04066;
  }

  .multiplier-low {
    color: #60c060;
    border-color: #60c06066;
  }

  .multiplier-free {
    color: var(--text-secondary);
  }
</style>
