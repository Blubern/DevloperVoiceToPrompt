<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import {
    type AppSettings,
    DEFAULT_SETTINGS,
    SUPPORTED_LANGUAGES,
    AZURE_REGIONS,
    saveSettings,
  } from "../lib/settingsStore";
  import { enumerateAudioDevices, checkMicrophonePermission, testAzureConnection, type AudioDevice } from "../lib/speechService";
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
  let saving = $state(false);
  let error = $state("");
  let success = $state(false);
  let showKey = $state(false);
  let langFilter = $state("");
  let audioDevices = $state<AudioDevice[]>([]);
  let micWarning = $state("");
  let apiStatus = $state<"idle" | "checking" | "ok" | "error">("idle");
  let apiError = $state("");

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
      key = initialSettings.azure_speech_key ?? "";
      region = initialSettings.azure_region ?? DEFAULT_SETTINGS.azure_region;
      languages = initialSettings.languages ?? [...DEFAULT_SETTINGS.languages];
      shortcut = initialSettings.shortcut ?? DEFAULT_SETTINGS.shortcut;
      microphoneDeviceId = initialSettings.microphone_device_id ?? "";
      const savedTheme = initialSettings.theme ?? DEFAULT_SETTINGS.theme;
      theme = savedTheme;
      document.documentElement.dataset.theme = savedTheme;
    }
  });

  onMount(async () => {
    const result = await enumerateAudioDevices();
    audioDevices = result.devices;
    micWarning = result.error ?? "";
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

  async function handleSave() {
    saving = true;
    error = "";
    success = false;

    try {
      await saveSettings({
        azure_speech_key: key,
        azure_region: region,
        languages,
        shortcut,
        microphone_device_id: microphoneDeviceId,
        theme,
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

  <form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
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
    </div>

    <div class="section">
      <h2>Shortcut</h2>

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
    </div>

    {#if error}
      <div class="message error">{error}</div>
    {/if}
    {#if success}
      <div class="message success">Settings saved!</div>
    {/if}

    <div class="footer">
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
    padding: 20px 24px;
    overflow-y: auto;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  h1 {
    margin: 0;
    font-size: 20px;
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
    display: flex;
    justify-content: flex-end;
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
</style>
