<script lang="ts">
  import ShortcutRecorder from "../ShortcutRecorder.svelte";
  import { DEFAULT_SETTINGS } from "../../lib/settingsStore";
  import { FONT_OPTIONS } from "../../lib/constants";
  import { invoke } from '@tauri-apps/api/core';

  let {
    theme = $bindable(),
    autostartEnabled = $bindable(),
    shortcut = $bindable(),
    popupCopyShortcut = $bindable(),
    popupVoiceShortcut = $bindable(),
    providerSwitchShortcut = $bindable(),
    alwaysOnTop = $bindable(),
    autoStartRecording = $bindable(),
    silenceTimeoutEnabled = $bindable(),
    silenceTimeoutSeconds = $bindable(),
    maxRecordingEnabled = $bindable(),
    maxRecordingSeconds = $bindable(),
    popupFont = $bindable(),
    openPopupOnStart = $bindable(),
    mcpEnabled = $bindable(),
    mcpPort = $bindable(),
    mcpTimeoutEnabled = $bindable(),
    mcpTimeoutSeconds = $bindable(),
    showInDock = $bindable(),
    isMac = false,
    isWindows = false,
    mcpRunning = false,
  }: {
    theme: string;
    autostartEnabled: boolean;
    shortcut: string;
    popupCopyShortcut: string;
    popupVoiceShortcut: string;
    providerSwitchShortcut: string;
    alwaysOnTop: boolean;
    autoStartRecording: boolean;
    silenceTimeoutEnabled: boolean;
    silenceTimeoutSeconds: number;
    maxRecordingEnabled: boolean;
    maxRecordingSeconds: number;
    popupFont: string;
    openPopupOnStart: boolean;
    mcpEnabled: boolean;
    mcpPort: number;
    mcpTimeoutEnabled: boolean;
    mcpTimeoutSeconds: number;
    showInDock: boolean;
    isMac: boolean;
    isWindows: boolean;
    mcpRunning: boolean;
  } = $props();

  let fontPreviewFamily = $derived(FONT_OPTIONS.find(o => o.value === popupFont)?.family ?? "inherit");

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  }

  function resetShortcutsToDefault() {
    shortcut = DEFAULT_SETTINGS.shortcut;
    popupCopyShortcut = DEFAULT_SETTINGS.popup_copy_shortcut;
    popupVoiceShortcut = DEFAULT_SETTINGS.popup_voice_shortcut;
    providerSwitchShortcut = DEFAULT_SETTINGS.provider_switch_shortcut;
  }

  // --- Storage & Data section ---
  type WhisperModelInfo = { name: string; label: string; size_mb: number; downloaded: boolean };

  let dataPath = $state<string | null>(null);
  let logPath = $state<string | null>(null);
  let whisperModels = $state<WhisperModelInfo[]>([]);
  let showDeleteModelsConfirm = $state(false);
  let deletingModels = $state(false);
  let showWipeConfirm = $state(false);

  let downloadedModels = $derived(whisperModels.filter(m => m.downloaded));
  let totalModelMb = $derived(downloadedModels.reduce((sum, m) => sum + m.size_mb, 0));

  async function loadStorageInfo() {
    const [path, logs, models] = await Promise.all([
      invoke<string>('get_app_data_path'),
      invoke<string>('get_log_path'),
      invoke<WhisperModelInfo[]>('whisper_list_models'),
    ]);
    dataPath = path;
    logPath = logs;
    whisperModels = models;
  }

  $effect(() => {
    loadStorageInfo().catch(() => {});
  });
</script>

<div class="section">
  <h2>General</h2>

  <div class="field">
    <span class="label">Theme</span>
    <div class="toggle-row">
      <button type="button" class="theme-toggle-inline" onclick={toggleTheme}>
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

  <div class="field">
    <span class="label">Popup Font</span>
    <select bind:value={popupFont}>
      {#each FONT_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <span class="hint">Font used in the dictation text area.</span>
    <div class="font-preview" style="font-family: {fontPreviewFamily}">
      The quick brown fox jumps over the lazy dog. 0O1lI {'{}()=>;'}
    </div>
  </div>
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

    {#if isMac || isWindows}
    <label class="field toggle-field">
      <span class="label">{isMac ? 'Show in Dock' : 'Show in Taskbar'}</span>
      <div class="toggle-row">
        <input type="checkbox" bind:checked={showInDock} class="toggle-checkbox" />
        <span class="toggle-label">{showInDock ? 'On' : 'Off'}</span>
      </div>
      <span class="hint">{isMac ? 'Show the app icon in the macOS Dock.' : 'Show the app icon in the Windows Taskbar.'} When off, the app is only accessible from the system tray.</span>
    </label>
    {/if}

    <label class="field toggle-field">
      <span class="label">Open Popup on Start</span>
      <div class="toggle-row">
        <input type="checkbox" bind:checked={openPopupOnStart} class="toggle-checkbox" />
        <span class="toggle-label">{openPopupOnStart ? 'On' : 'Off'}</span>
      </div>
      <span class="hint">Automatically show the dictation popup when the application starts.</span>
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

    <div class="field">
      <button type="button" class="toggle-btn" onclick={resetShortcutsToDefault}>Reset All Shortcuts to Default</button>
      <span class="hint">Restore all keyboard shortcuts on this page to their default values.</span>
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
          <input type="number" min="10" max="300" bind:value={silenceTimeoutSeconds} style="width: 80px;" />
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
          <input type="number" min="30" max="600" bind:value={maxRecordingSeconds} style="width: 80px;" />
          <span class="timeout-unit">seconds</span>
        </div>
      {/if}
      <span class="hint">Safety limit to prevent accidental long recordings. Automatically stops after this duration regardless of speech activity. Default 180 seconds (3 minutes).</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">MCP Server</div>
    <div class="field">
      <label class="toggle-field">
        <span class="label">Enable MCP Server</span>
        <div class="toggle-row">
          <input type="checkbox" bind:checked={mcpEnabled} class="toggle-checkbox" />
          <span class="toggle-label">{mcpEnabled ? 'On' : 'Off'}</span>
          <span class="mcp-status-badge" class:running={mcpRunning} class:stopped={!mcpRunning}>
            {mcpRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
      </label>
      <span class="hint">Expose a local MCP (Model Context Protocol) server so AI tools like GitHub Copilot can request voice input. Takes effect when you save settings.</span>
    </div>
    {#if mcpEnabled}
      <div class="field">
        <label class="label" for="mcp-port">Port</label>
        <input id="mcp-port" type="number" min="1024" max="65535" bind:value={mcpPort} style="width: 100px;" />
        <span class="hint">Default: 31337. Changes take effect when you save settings.</span>
      </div>
      <div class="field">
        <label class="toggle-field">
          <span class="label">Request Timeout</span>
          <div class="toggle-row">
            <input type="checkbox" bind:checked={mcpTimeoutEnabled} class="toggle-checkbox" />
            <span class="toggle-label">{mcpTimeoutEnabled ? 'On' : 'Off'}</span>
          </div>
        </label>
        {#if mcpTimeoutEnabled}
          <div class="input-row" style="margin-top: 6px;">
            <input type="number" min="10" max="3600" bind:value={mcpTimeoutSeconds} style="width: 90px;" />
            <span class="timeout-unit">seconds</span>
          </div>
        {/if}
        <span class="hint">How long the MCP server waits for you to submit dictated text. Set 10-3600 seconds, or turn it off to wait indefinitely.</span>
      </div>
      <div class="field">
        <span class="label">Server Endpoint</span>
        <div class="mcp-url-row">
          <code class="mcp-url">http://localhost:{mcpPort}/mcp</code>
        </div>
        <span class="hint">Add this URL to your AI tool's MCP server configuration.</span>
      </div>
      <div class="field">
        <span class="label">Transport</span>
        <span class="mcp-transport-info">HTTP</span>
        <span class="hint">Uses a standard HTTP endpoint.</span>
      </div>
      <div class="field">
        <span class="label">VS Code Configuration</span>
        <span class="hint">Add this to your VS Code <code>settings.json</code> to connect:</span>
        <pre class="mcp-config-block"><code>{`"mcp": {
  "servers": {
    "DeveloperVoiceToText": {
      "url": "http://localhost:${mcpPort}/mcp"
    }
  }
}`}</code></pre>
      </div>
      <div class="field">
        <span class="label">Available Tools</span>
        <div class="mcp-tool-card">
          <div class="mcp-tool-header">
            <code class="mcp-tool-name">voice_to_text</code>
          </div>
          <p class="mcp-tool-desc">Open the voice dictation popup. The user speaks or edits the text, then submits. Returns the final text.</p>
          <div class="mcp-params">
            <div class="mcp-param">
              <span class="mcp-param-name">input_reason</span>
              <span class="mcp-param-type">string, required</span>
              <span class="mcp-param-desc">Why the voice input is being requested. Shown as a context banner in the dictation popup (e.g. "Write a commit message for the staged changes").</span>
            </div>
            <div class="mcp-param">
              <span class="mcp-param-name">context_input</span>
              <span class="mcp-param-type">string, optional</span>
              <span class="mcp-param-desc">Pre-filled text to load into the dictation textarea. The user can edit or replace it by voice or keyboard before submitting.</span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>

<div class="section">
  <h2>Storage & Data</h2>

  <div class="field">
    <span class="label">App Data Folder</span>
    <div class="data-path-row">
      <code class="data-path">{dataPath ?? 'Loading…'}</code>
      <button type="button" class="toggle-btn" onclick={() => invoke('open_app_data_folder')}>Open Folder</button>
    </div>
    <span class="hint">All settings, history, templates and Whisper models are stored in this folder.</span>
  </div>

  <div class="field">
    <span class="label">Logs Folder</span>
    <div class="data-path-row">
      <code class="data-path">{logPath ?? 'Loading…'}</code>
      <button type="button" class="toggle-btn" onclick={() => invoke('open_log_folder')}>Open Folder</button>
    </div>
    <span class="hint">Logs are stored in a separate OS-specific folder on Windows and macOS.</span>
  </div>

  <div class="field">
    <span class="label">Whisper Models</span>
    {#if showDeleteModelsConfirm}
      <div class="usage-actions">
        <span class="reset-confirm-text">Delete {downloadedModels.length} model{downloadedModels.length !== 1 ? 's' : ''} ({totalModelMb} MB)?</span>
        <button type="button" class="toggle-btn reset-yes" disabled={deletingModels} onclick={async () => {
          deletingModels = true;
          await invoke('delete_all_whisper_models');
          whisperModels = await invoke<WhisperModelInfo[]>('whisper_list_models');
          deletingModels = false;
          showDeleteModelsConfirm = false;
        }}>{deletingModels ? 'Deleting…' : 'Yes, delete'}</button>
        <button type="button" class="toggle-btn" onclick={() => (showDeleteModelsConfirm = false)}>Cancel</button>
      </div>
    {:else}
      <div class="usage-actions">
        {#if downloadedModels.length > 0}
          <span class="reset-confirm-text">{downloadedModels.length} downloaded ({totalModelMb} MB)</span>
          <button type="button" class="toggle-btn" onclick={() => (showDeleteModelsConfirm = true)}>Delete All</button>
        {:else}
          <span class="reset-confirm-text">No models downloaded</span>
        {/if}
      </div>
    {/if}
    <span class="hint">Whisper speech recognition models. Can be re-downloaded from the Speech settings.</span>
  </div>

  <div class="field">
    <span class="label">Wipe All App Data</span>
    {#if showWipeConfirm}
      <div class="usage-actions">
        <span class="reset-confirm-text wipe-warning">This will permanently delete all settings, history, templates, models and logs, then restart the app.</span>
        <button type="button" class="toggle-btn reset-yes" onclick={() => { invoke('wipe_all_app_data'); }}>Confirm Reset & Restart</button>
        <button type="button" class="toggle-btn" onclick={() => (showWipeConfirm = false)}>Cancel</button>
      </div>
    {:else}
      <div class="usage-actions">
        <button type="button" class="toggle-btn reset-yes" onclick={() => (showWipeConfirm = true)}>Wipe All Data…</button>
      </div>
    {/if}
    <span class="hint">Permanently removes all app data and restarts. Use before uninstalling for a clean removal.</span>
  </div>
</div>

<style>
  .font-preview {
    margin-top: 6px;
    padding: 8px 10px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .mcp-url-row {
    margin-top: 4px;
  }

  .mcp-url {
    display: inline-block;
    padding: 4px 8px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-primary);
    user-select: all;
  }

  .mcp-status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    margin-left: 8px;
  }

  .mcp-status-badge.running {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }

  .mcp-status-badge.stopped {
    background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
    color: var(--text-secondary);
  }

  .mcp-transport-info {
    display: inline-block;
    padding: 4px 8px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-primary);
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .mcp-config-block {
    margin-top: 4px;
    padding: 10px 12px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-primary);
    overflow-x: auto;
    user-select: all;
    white-space: pre;
  }

  .mcp-config-block code {
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .mcp-tool-card {
    margin-top: 4px;
    padding: 10px 12px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .mcp-tool-header {
    margin-bottom: 4px;
  }

  .mcp-tool-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .mcp-tool-desc {
    font-size: 12px;
    color: var(--text-secondary);
    margin: 0 0 8px 0;
    line-height: 1.4;
  }

  .mcp-params {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mcp-param {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    background: var(--bg-secondary);
    border-radius: 4px;
  }

  .mcp-param-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .mcp-param-type {
    font-size: 11px;
    color: var(--accent);
    font-style: italic;
  }

  .mcp-param-desc {
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .data-path-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .data-path {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  }

  .wipe-warning {
    color: var(--error);
  }
</style>
