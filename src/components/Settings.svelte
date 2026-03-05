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
  import { getUsageStats, resetUsage, pruneOldEntries, formatDuration, type UsageStats } from "../lib/usageStore";
  import { clearHistory, pruneHistory } from "../lib/historyStore";
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
  let phraseList = $state<string[]>([]);
  let newPhrase = $state("");
  let alwaysOnTop = $state(DEFAULT_SETTINGS.always_on_top);
  let autoPunctuation = $state(DEFAULT_SETTINGS.auto_punctuation);
  let silenceTimeoutEnabled = $state(true);
  let silenceTimeoutSeconds = $state(DEFAULT_SETTINGS.silence_timeout_seconds);
  let historyEnabled = $state(DEFAULT_SETTINGS.history_enabled);
  let historyMaxEntries = $state(DEFAULT_SETTINGS.history_max_entries);
  let popupCopyShortcut = $state(DEFAULT_SETTINGS.popup_copy_shortcut);
  let popupVoiceShortcut = $state(DEFAULT_SETTINGS.popup_voice_shortcut);

  // Tab navigation
  let activeTab = $state<"general" | "speech" | "phrases" | "history" | "usage">("general");

  // Usage statistics
  let usageStats = $state<UsageStats | null>(null);
  let showResetConfirm = $state(false);
  let showClearHistoryConfirm = $state(false);

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
      phraseList = initialSettings.phrase_list ? [...initialSettings.phrase_list] : [];
      alwaysOnTop = initialSettings.always_on_top ?? DEFAULT_SETTINGS.always_on_top;
      autoPunctuation = initialSettings.auto_punctuation ?? DEFAULT_SETTINGS.auto_punctuation;
      const savedTimeout = initialSettings.silence_timeout_seconds ?? DEFAULT_SETTINGS.silence_timeout_seconds;
      silenceTimeoutEnabled = savedTimeout > 0;
      silenceTimeoutSeconds = savedTimeout > 0 ? savedTimeout : 30;
      historyEnabled = initialSettings.history_enabled ?? DEFAULT_SETTINGS.history_enabled;
      historyMaxEntries = initialSettings.history_max_entries ?? DEFAULT_SETTINGS.history_max_entries;
      popupCopyShortcut = initialSettings.popup_copy_shortcut ?? DEFAULT_SETTINGS.popup_copy_shortcut;
      popupVoiceShortcut = initialSettings.popup_voice_shortcut ?? DEFAULT_SETTINGS.popup_voice_shortcut;
      const savedTheme = initialSettings.theme ?? DEFAULT_SETTINGS.theme;
      theme = savedTheme;
      document.documentElement.dataset.theme = savedTheme;
    }
  });

  onMount(async () => {
    const result = await enumerateAudioDevices();
    audioDevices = result.devices;
    micWarning = result.error ?? "";
    // Load usage stats and prune old entries
    await pruneOldEntries();
    usageStats = await getUsageStats();
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
        azure_speech_key: key,
        azure_region: region,
        languages,
        shortcut,
        microphone_device_id: microphoneDeviceId,
        theme,
        phrase_list: phraseList,
        always_on_top: alwaysOnTop,
        auto_punctuation: autoPunctuation,
        silence_timeout_seconds: silenceTimeoutEnabled ? silenceTimeoutSeconds : 0,
        history_enabled: historyEnabled,
        history_max_entries: historyMaxEntries,
        popup_copy_shortcut: popupCopyShortcut,
        popup_voice_shortcut: popupVoiceShortcut,
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
    <div class="tab-bar">
      <button type="button" class="tab" class:active={activeTab === 'general'} onclick={() => activeTab = 'general'}>General</button>
      <button type="button" class="tab" class:active={activeTab === 'speech'} onclick={() => activeTab = 'speech'}>Speech</button>
      <button type="button" class="tab" class:active={activeTab === 'phrases'} onclick={() => activeTab = 'phrases'}>Phrases</button>
      <button type="button" class="tab" class:active={activeTab === 'history'} onclick={() => activeTab = 'history'}>History</button>
      <button type="button" class="tab" class:active={activeTab === 'usage'} onclick={() => activeTab = 'usage'}>Usage</button>
    </div>

    {#if activeTab === 'speech'}
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
    {/if}

    {#if activeTab === 'phrases'}
    <div class="section">
      <h2>Phrase List</h2>

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

      <label class="field toggle-field">
        <span class="label">Always on Top</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={alwaysOnTop} class="toggle-checkbox" />
          <span class="toggle-label">{alwaysOnTop ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Keep the dictation popup above other windows.</span>
      </label>

      <label class="field toggle-field">
        <span class="label">Auto Punctuation</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={autoPunctuation} class="toggle-checkbox" />
          <span class="toggle-label">{autoPunctuation ? 'On' : 'Off'}</span>
        </div>
        <span class="hint">Automatically add punctuation and capitalization to dictated text.</span>
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
    </div>
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
        <div class="usage-grid">
          <div class="usage-card">
            <span class="usage-label">Today</span>
            <span class="usage-value">{formatDuration(usageStats.today)}</span>
          </div>
          <div class="usage-card">
            <span class="usage-label">This Week</span>
            <span class="usage-value">{formatDuration(usageStats.thisWeek)}</span>
          </div>
          <div class="usage-card">
            <span class="usage-label">Calendar Month</span>
            <span class="usage-value">{formatDuration(usageStats.calendarMonth)}</span>
          </div>
          <div class="usage-card">
            <span class="usage-label">Last 30 Days</span>
            <span class="usage-value">{formatDuration(usageStats.last30Days)}</span>
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

  .tab-bar {
    display: flex;
    gap: 2px;
    margin-bottom: 16px;
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

  .usage-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
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
</style>
