<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
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

  interface Props {
    initialSettings: AppSettings | null;
    onSaved?: () => void;
  }

  let { initialSettings, onSaved }: Props = $props();

  // All settings state (two-way bound into tab sub-components)
  let speechProvider = $state<"os" | "azure" | "whisper">(DEFAULT_SETTINGS.speech_provider);
  let osLanguage = $state(DEFAULT_SETTINGS.os_language);
  let osAutoRestart = $state(DEFAULT_SETTINGS.os_auto_restart);
  let osMaxRestarts = $state(DEFAULT_SETTINGS.os_max_restarts);
  let key = $state("");
  let region = $state(DEFAULT_SETTINGS.azure_region);
  let languages = $state<string[]>([...DEFAULT_SETTINGS.languages]);
  let shortcut = $state(DEFAULT_SETTINGS.shortcut);
  let microphoneDeviceId = $state("");
  let theme = $state(DEFAULT_SETTINGS.theme);
  let phraseList = $state<string[]>([]);
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
  let whisperModel = $state(DEFAULT_SETTINGS.whisper_model);
  let whisperLanguage = $state(DEFAULT_SETTINGS.whisper_language);
  let whisperChunkSeconds = $state(DEFAULT_SETTINGS.whisper_chunk_seconds);
  let copilotEnabled = $state(DEFAULT_SETTINGS.copilot_enabled);
  let copilotSelectedModel = $state(DEFAULT_SETTINGS.copilot_selected_model);
  let copilotSelectedEnhancer = $state(DEFAULT_SETTINGS.copilot_selected_enhancer);
  let promptEnhancerShortcut = $state(DEFAULT_SETTINGS.prompt_enhancer_shortcut);

  // Shell-only state
  let saving = $state(false);
  let error = $state("");
  let success = $state(false);
  let audioDevices = $state<AudioDevice[]>([]);
  let micWarning = $state("");
  let activeTab = $state<"general" | "speech" | "phrases" | "templates" | "history" | "usage" | "copilot">("general");

  // Sync local state from initialSettings prop
  $effect(() => {
    if (!initialSettings) return;
    const s = initialSettings;
    speechProvider = s.speech_provider ?? DEFAULT_SETTINGS.speech_provider;
    osLanguage = s.os_language ?? DEFAULT_SETTINGS.os_language;
    osAutoRestart = s.os_auto_restart ?? DEFAULT_SETTINGS.os_auto_restart;
    osMaxRestarts = s.os_max_restarts ?? DEFAULT_SETTINGS.os_max_restarts;
    key = s.azure_speech_key ?? "";
    region = s.azure_region ?? DEFAULT_SETTINGS.azure_region;
    languages = s.languages ?? [...DEFAULT_SETTINGS.languages];
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
    copilotEnabled = s.copilot_enabled ?? DEFAULT_SETTINGS.copilot_enabled;
    copilotSelectedModel = s.copilot_selected_model ?? DEFAULT_SETTINGS.copilot_selected_model;
    copilotSelectedEnhancer = s.copilot_selected_enhancer ?? DEFAULT_SETTINGS.copilot_selected_enhancer;
    promptEnhancerShortcut = s.prompt_enhancer_shortcut ?? DEFAULT_SETTINGS.prompt_enhancer_shortcut;
    const savedTheme = s.theme ?? DEFAULT_SETTINGS.theme;
    theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
  });

  // isDirty: compare current state to saved settings via JSON snapshot
  function buildSettingsObject(): AppSettings {
    return {
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
      copilot_enabled: copilotEnabled,
      copilot_selected_model: copilotSelectedModel,
      copilot_selected_enhancer: copilotSelectedEnhancer,
      prompt_enhancer_shortcut: promptEnhancerShortcut,
    };
  }

  let isDirty = $derived.by(() => {
    if (!initialSettings) return false;
    const sortedStringify = (obj: object) => JSON.stringify(obj, Object.keys(obj).sort());
    return sortedStringify(buildSettingsObject()) !== sortedStringify(initialSettings);
  });

  function revertChanges() {
    if (!initialSettings) return;
    // Re-trigger the sync effect by reassigning (the $effect above handles it)
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
    copilotEnabled = s.copilot_enabled ?? DEFAULT_SETTINGS.copilot_enabled;
    copilotSelectedModel = s.copilot_selected_model ?? DEFAULT_SETTINGS.copilot_selected_model;
    copilotSelectedEnhancer = s.copilot_selected_enhancer ?? DEFAULT_SETTINGS.copilot_selected_enhancer;
    promptEnhancerShortcut = s.prompt_enhancer_shortcut ?? DEFAULT_SETTINGS.prompt_enhancer_shortcut;
    const savedTheme = s.theme ?? DEFAULT_SETTINGS.theme;
    theme = savedTheme;
    document.documentElement.dataset.theme = savedTheme;
    error = "";
    success = false;
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  }

  onMount(async () => {
    const result = await enumerateAudioDevices();
    audioDevices = result.devices;
    micWarning = result.error ?? "";
  });

  async function handleSave() {
    saving = true;
    error = "";
    success = false;
    try {
      await saveSettings(buildSettingsObject());
      success = true;
      onSaved?.();
      await emit(EVENT_SETTINGS_UPDATED);
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
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        {#if theme === 'dark'}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        {/if}
      </button>
    </div>
    <div class="tab-bar">
      {#each [
        ["general", "General"], ["speech", "Speech"], ["phrases", "Phrases"],
        ["templates", "Templates"], ["history", "History"], ["usage", "Usage"], ["copilot", "GitHub Copilot"]
      ] as [id, label]}
        <button type="button" class="tab" class:active={activeTab === id} onclick={() => activeTab = id as typeof activeTab}>{label}</button>
      {/each}
    </div>
  </div>

  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
    <div class="settings-body">
      {#if activeTab === 'general'}
        <GeneralTab bind:theme bind:autostartEnabled bind:shortcut bind:popupCopyShortcut
          bind:popupVoiceShortcut bind:providerSwitchShortcut bind:alwaysOnTop
          bind:autoStartRecording bind:silenceTimeoutEnabled bind:silenceTimeoutSeconds
          bind:maxRecordingEnabled bind:maxRecordingSeconds />
      {:else if activeTab === 'speech'}
        <SpeechTab bind:speechProvider bind:osLanguage bind:osAutoRestart bind:osMaxRestarts
          bind:key bind:region bind:languages bind:microphoneDeviceId bind:autoPunctuation
          bind:whisperModel bind:whisperLanguage bind:whisperChunkSeconds
          {audioDevices} {micWarning} bind:error />
      {:else if activeTab === 'phrases'}
        <PhrasesTab bind:phraseList />
      {:else if activeTab === 'templates'}
        <TemplatesTab />
      {:else if activeTab === 'history'}
        <HistoryTab bind:historyEnabled bind:historyMaxEntries />
      {:else if activeTab === 'usage'}
        <UsageTab />
      {:else if activeTab === 'copilot'}
        <CopilotTab bind:copilotEnabled bind:copilotSelectedModel bind:copilotSelectedEnhancer bind:promptEnhancerShortcut />
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
  .tab-bar { display: flex; gap: 2px; background: var(--bg-secondary); border-radius: 8px; padding: 3px; border: 1px solid var(--border); }
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
