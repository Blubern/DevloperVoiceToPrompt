<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import {
    type AppSettings,
    DEFAULT_SETTINGS,
    saveSettings,
  } from "../lib/settingsStore";
  import { enumerateAudioDevices, type AudioDevice } from "../lib/speechService";
  import { onMount } from "svelte";
  import { EVENT_SETTINGS_UPDATED } from "../lib/constants";

  import GeneralTab from "./settings/GeneralTab.svelte";
  import SpeechTab from "./settings/SpeechTab.svelte";
  import PhrasesTab from "./settings/PhrasesTab.svelte";
  import TemplatesTab from "./settings/TemplatesTab.svelte";
  import HistoryTab from "./settings/HistoryTab.svelte";
  import UsageTab from "./settings/UsageTab.svelte";
  import CopilotTab from "./settings/CopilotTab.svelte";
  import LogsTab from "./settings/LogsTab.svelte";

  interface Props {
    initialSettings: AppSettings | null;
    onSaved?: () => void;
  }

  let { initialSettings, onSaved }: Props = $props();

  // Single reactive settings object — child tabs bind directly to its properties.
  // Adding a new setting only requires updating AppSettings + DEFAULT_SETTINGS + the
  // relevant tab binding. No separate hydrate/build sync needed.
  let s = $state<AppSettings>({ ...DEFAULT_SETTINGS });

  // UI-only derived toggles (not part of AppSettings — the actual timeout value of 0
  // means "disabled", but the UI shows a separate checkbox + number input)
  let silenceTimeoutEnabled = $state(true);
  let mcpTimeoutEnabled = $state(true);
  let isMac = $state(false);
  let isWindows = $state(false);

  // Shell-only state
  let saving = $state(false);
  let error = $state("");
  let success = $state(false);
  let audioDevices = $state<AudioDevice[]>([]);
  let micWarning = $state("");
  let activeTab = $state<"general" | "speech" | "phrases" | "templates" | "history" | "usage" | "copilot" | "logs">("general");
  let mcpRunning = $state(false);

  /** Hydrate form state from a settings object. */
  function hydrateFromSettings(src: AppSettings) {
    // Derive UI-only timeout toggles from the SOURCE, not from `s`,
    // to avoid creating reactive dependencies inside $effect.
    const srcSilenceEnabled = src.silence_timeout_seconds > 0;
    const srcMcpEnabled = src.mcp_timeout_seconds > 0;

    s = {
      ...DEFAULT_SETTINGS,
      ...src,
      // Deep-copy arrays so form edits don't mutate the source
      languages: src.languages ? [...src.languages] : [...DEFAULT_SETTINGS.languages],
      phrase_list: src.phrase_list ? [...src.phrase_list] : [],
      // Override timeout values for the UI when disabled
      silence_timeout_seconds: srcSilenceEnabled ? src.silence_timeout_seconds : 30,
      mcp_timeout_seconds: srcMcpEnabled ? src.mcp_timeout_seconds : DEFAULT_SETTINGS.mcp_timeout_seconds,
    };
    silenceTimeoutEnabled = srcSilenceEnabled;
    mcpTimeoutEnabled = srcMcpEnabled;
    document.documentElement.dataset.theme = src.theme;
  }

  // Sync local state from initialSettings prop
  $effect(() => {
    if (!initialSettings) return;
    hydrateFromSettings(initialSettings);
  });

  /** Build the settings object to save, applying timeout toggle semantics. */
  function buildSettingsObject(): AppSettings {
    return {
      ...s,
      silence_timeout_seconds: silenceTimeoutEnabled ? s.silence_timeout_seconds : 0,
      mcp_timeout_seconds: mcpTimeoutEnabled ? s.mcp_timeout_seconds : 0,
    };
  }

  let isDirty = $derived.by(() => {
    if (!initialSettings) return false;
    const sortedStringify = (obj: object) => JSON.stringify(obj, Object.keys(obj).sort());
    return sortedStringify(buildSettingsObject()) !== sortedStringify(initialSettings);
  });

  function revertChanges() {
    if (!initialSettings) return;
    hydrateFromSettings(initialSettings);
    error = "";
    success = false;
  }

  function toggleTheme() {
    s.theme = s.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = s.theme;
  }

  async function refreshMcpStatus() {
    try {
      mcpRunning = await invoke<boolean>("is_mcp_running");
    } catch {
      mcpRunning = false;
    }
  }

  onMount(async () => {
    isMac = navigator.userAgent.includes("Macintosh") || navigator.platform === "MacIntel";
    isWindows = navigator.userAgent.includes("Windows");

    const result = await enumerateAudioDevices();
    audioDevices = result.devices;
    micWarning = result.error ?? "";

    await refreshMcpStatus();
  });

  async function handleSave() {
    if (initialSettings) {
      const wasMcpOn = initialSettings.mcp_enabled;
      const isDisabling = wasMcpOn && !s.mcp_enabled;
      const isPortChanging = wasMcpOn && s.mcp_enabled && s.mcp_port !== initialSettings.mcp_port;
      if (isDisabling || isPortChanging) {
        const msg = isDisabling
          ? "Disabling the MCP server will drop all active connections. AI tools using this server will need to reconnect. Continue?"
          : "Changing the MCP server port will drop all active connections. AI tools using this server will need to reconnect with the new port. Continue?";
        if (!confirm(msg)) return;
      }
    }

    saving = true;
    error = "";
    success = false;
    try {
      await saveSettings(buildSettingsObject());
      success = true;
      onSaved?.();
      await emit(EVENT_SETTINGS_UPDATED);
      setTimeout(refreshMcpStatus, 500);
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
      <button type="button" class="theme-toggle" onclick={toggleTheme}
        title={s.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {#if s.theme === 'dark'}
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
      <button type="button" class="tab" class:active={activeTab === 'logs'} onclick={() => activeTab = 'logs'}>Logs</button>
    </div>
  </div>

  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="settings-body">
      {#if activeTab === 'general'}
        <GeneralTab bind:theme={s.theme} bind:autostartEnabled={s.autostart_enabled} bind:shortcut={s.shortcut} bind:popupCopyShortcut={s.popup_copy_shortcut}
          bind:popupVoiceShortcut={s.popup_voice_shortcut} bind:providerSwitchShortcut={s.provider_switch_shortcut} bind:alwaysOnTop={s.always_on_top}
          bind:autoStartRecording={s.auto_start_recording} bind:silenceTimeoutEnabled bind:silenceTimeoutSeconds={s.silence_timeout_seconds}
          bind:maxRecordingEnabled={s.max_recording_enabled} bind:maxRecordingSeconds={s.max_recording_seconds} bind:popupFont={s.popup_font} bind:openPopupOnStart={s.open_popup_on_start}
          bind:mcpEnabled={s.mcp_enabled} bind:mcpPort={s.mcp_port} bind:mcpTimeoutEnabled bind:mcpTimeoutSeconds={s.mcp_timeout_seconds}
          bind:showInDock={s.show_in_dock} bind:speechTracing={s.speech_tracing} bind:speechTraceMaxEntries={s.speech_trace_max_entries}
          {isMac} {isWindows} {mcpRunning} />
      {:else if activeTab === 'speech'}
        <SpeechTab bind:speechProvider={s.speech_provider} bind:osLanguage={s.os_language} bind:osAutoRestart={s.os_auto_restart} bind:osMaxRestarts={s.os_max_restarts}
          bind:key={s.azure_speech_key} bind:region={s.azure_region} bind:languages={s.languages} bind:microphoneDeviceId={s.microphone_device_id} bind:autoPunctuation={s.auto_punctuation}
          bind:whisperModel={s.whisper_model} bind:whisperLanguage={s.whisper_language} bind:whisperChunkSeconds={s.whisper_chunk_seconds}
          bind:whisperDecodeInterval={s.whisper_decode_interval} bind:whisperContextOverlap={s.whisper_context_overlap}
          bind:whisperCliVersion={s.whisper_cli_version} bind:whisperCliVariant={s.whisper_cli_variant} bind:whisperUseGpu={s.whisper_use_gpu}
          bind:speechTracing={s.speech_tracing}
          {audioDevices} {micWarning} {isMac} bind:error />
      {:else if activeTab === 'phrases'}
        <PhrasesTab bind:phraseList={s.phrase_list} />
      {:else if activeTab === 'templates'}
        <TemplatesTab />
      {:else if activeTab === 'history'}
        <HistoryTab bind:historyEnabled={s.history_enabled} bind:historyMaxEntries={s.history_max_entries} />
      {:else if activeTab === 'usage'}
        <UsageTab />
      {:else if activeTab === 'copilot'}
        <CopilotTab bind:copilotEnabled={s.copilot_enabled} bind:copilotSelectedModel={s.copilot_selected_model} bind:copilotSelectedEnhancer={s.copilot_selected_enhancer} bind:copilotDeleteSessions={s.copilot_delete_sessions} bind:promptEnhancerShortcut={s.prompt_enhancer_shortcut} />
      {:else if activeTab === 'logs'}
        <LogsTab />
      {/if}
    </div>

    {#if error}
      <div class="message error">{error}</div>
    {/if}
    {#if success}
      <div class="message success">Settings saved!</div>
    {/if}

    <div class="footer" class:has-changes={isDirty}>
      {#if isDirty}
        <span class="unsaved-label">Unsaved changes</span>
        <button type="button" class="btn btn-discard" onclick={revertChanges}>Discard</button>
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
  .settings-header { flex-shrink: 0; padding: 20px 24px 0; }
  form { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0 24px; gap: 20px; }
  .settings-body { flex: 1; overflow-y: auto; padding: 16px 0 8px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; }
  .tab-bar { display: flex; gap: 2px; background: var(--bg-sidebar); border-radius: 8px; padding: 3px; border: 1px solid var(--border); }
  .tab { flex: 1; padding: 7px 0; background: none; border: none; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; border-radius: 6px; transition: all 0.15s; }
  .tab:hover { color: var(--text-primary); background: var(--surface-hover); }
  .tab.active { background: var(--accent); color: var(--bg-primary); font-weight: 600; }
  .theme-toggle { background: none; border: 1px solid var(--border); color: var(--text-secondary); cursor: pointer; padding: 6px 8px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
  .theme-toggle:hover { background: var(--surface-hover); color: var(--accent); border-color: var(--accent); }
  .footer { flex-shrink: 0; display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 12px 0; border-top: 1px solid var(--border); transition: border-color 0.2s, background 0.2s; }
  .footer.has-changes { border-top-color: var(--warning); padding: 10px 12px; margin: 0 -12px; background: var(--warning-bg); }
  .unsaved-label { font-size: 12px; font-weight: 600; color: var(--warning); margin-right: auto; }
  .btn { padding: 8px 20px; border: none; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: var(--bg-primary); }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-discard { background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary); }
  .btn-discard:hover { background: var(--surface-hover); color: var(--text-primary); border-color: var(--text-muted); }
</style>
