<script lang="ts">
  import ShortcutRecorder from "../ShortcutRecorder.svelte";

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
  } = $props();

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  }
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
</div>
