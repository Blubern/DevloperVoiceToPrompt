<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { load, type Store } from "@tauri-apps/plugin-store";
  import type { AppSettings } from "../lib/settingsStore";
  import {
    SUPPORTED_LANGUAGES,
  } from "../lib/settingsStore";
  import {
    createRecognizer,
    startContinuousRecognition,
    stopContinuousRecognition,
    disposeRecognizer,
    checkMicrophonePermission,
    type SpeechCallbacks,
  } from "../lib/speechService";
  import { recordUsage } from "../lib/usageStore";
  import { addHistoryEntry, getHistory, deleteHistoryEntry, formatRelativeTime, type HistoryEntry } from "../lib/historyStore";
  import MicButton from "./MicButton.svelte";

  interface Props {
    settings: AppSettings;
  }

  let { settings }: Props = $props();

  let status = $state<"idle" | "listening" | "error">("idle");
  let finalSegments = $state<string[]>([]);
  let interimText = $state("");
  let errorMessage = $state("");
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // Track user's edited text separately from speech output
  let editedText = $state("");
  let userHasEdited = $state(false);
  let lastSyncedSegmentCount = $state(0);

  // Usage tracking: record start time of current recognition session
  let sessionStartTime: number | null = null;

  // Silence auto-stop timer
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceMessage = $state("");

  // Window resize/move debounce
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

  // History panel
  let historyOpen = $state(false);
  let historyEntries = $state<HistoryEntry[]>([]);
  let historyCount = $state(0);

  // Parse a Tauri-format shortcut string and match against a KeyboardEvent
  function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
    if (!shortcutStr) return false;
    const parts = shortcutStr.split("+").map((p) => p.trim().toLowerCase());
    const key = parts[parts.length - 1];
    const mods = new Set(parts.slice(0, -1));

    const needCtrlOrMeta = mods.has("commandorcontrol");
    const needCtrl = mods.has("control") || needCtrlOrMeta;
    const needMeta = mods.has("meta") || needCtrlOrMeta;
    const needShift = mods.has("shift");
    const needAlt = mods.has("alt");

    const ctrlOk = needCtrlOrMeta ? (e.ctrlKey || e.metaKey) : (needCtrl ? e.ctrlKey : !e.ctrlKey);
    const metaOk = needCtrlOrMeta ? true : (needMeta ? e.metaKey : !e.metaKey);
    const shiftOk = needShift ? e.shiftKey : !e.shiftKey;
    const altOk = needAlt ? e.altKey : !e.altKey;

    const keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key;

    return ctrlOk && metaOk && shiftOk && altOk && keyMatch;
  }

  // Format a Tauri shortcut string to a human-readable label
  function formatShortcutLabel(shortcutStr: string): string {
    if (!shortcutStr) return "";
    return shortcutStr
      .replace(/CommandOrControl/gi, "Ctrl")
      .replace(/Control/gi, "Ctrl")
      .replace(/Meta/gi, "⌘")
      .replace(/\+/g, "+");
  }

  // Language labels for display
  let languageLabels = $derived(
    settings.languages.map((code) => {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
      return lang ? lang.label.split(" ")[0] : code;
    })
  );

  $effect(() => {
    const segmentCount = finalSegments.length;
    const currentInterim = interimText;

    if (!userHasEdited) {
      // No user edits — just mirror speech output
      editedText =
        finalSegments.join(" ") +
        (currentInterim ? (segmentCount ? " " : "") + currentInterim : "");
      lastSyncedSegmentCount = segmentCount;
    } else if (segmentCount > lastSyncedSegmentCount) {
      // User has edited — only append NEW segments
      const newSegments = finalSegments.slice(lastSyncedSegmentCount);
      if (newSegments.length > 0) {
        const addition = newSegments.join(" ");
        editedText = editedText.trimEnd() + " " + addition;
      }
      lastSyncedSegmentCount = segmentCount;
    }
  });

  // Persist window size and position on resize/move
  $effect(() => {
    const win = getCurrentWindow();
    const unlisteners: Array<() => void> = [];

    async function saveGeometry() {
      try {
        const size = await win.innerSize();
        const pos = await win.outerPosition();
        const sf = await win.scaleFactor();
        const s: Store = await load("settings.json");
        await s.set("popup_width", size.width / sf);
        await s.set("popup_height", size.height / sf);
        await s.set("popup_x", pos.x / sf);
        await s.set("popup_y", pos.y / sf);
      } catch {}
    }

    function debouncedSave() {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(saveGeometry, 300);
    }

    win.onResized(() => debouncedSave()).then((u) => unlisteners.push(u));
    win.onMoved(() => debouncedSave()).then((u) => unlisteners.push(u));

    // Refresh history when window regains focus
    win.onFocusChanged(({ payload: focused }) => {
      if (focused && historyOpen && settings.history_enabled) {
        getHistory().then(entries => {
          historyEntries = entries;
          historyCount = entries.length;
        });
      }
    }).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
      if (resizeDebounce) clearTimeout(resizeDebounce);
    };
  });

  // Load history count for badge
  $effect(() => {
    if (settings.history_enabled) {
      getHistory().then(entries => { historyCount = entries.length; });
    } else {
      historyCount = 0;
    }
  });

  function handleTextInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    editedText = target.value;
    userHasEdited = true;
  }

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
    const timeout = settings.silence_timeout_seconds;
    if (timeout > 0 && status === "listening") {
      silenceTimer = setTimeout(async () => {
        silenceMessage = "Stopped — no speech detected";
        await stopAndRecordUsage();
        setTimeout(() => (silenceMessage = ""), 4000);
      }, timeout * 1000);
    }
  }

  async function stopAndRecordUsage() {
    await stopContinuousRecognition();
    status = "idle";
    clearSilenceTimer();
    // Record usage
    if (sessionStartTime !== null) {
      const elapsed = (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
      await recordUsage(elapsed);
    }
  }

  async function toggleMic() {
    if (status === "listening") {
      await stopAndRecordUsage();
      return;
    }

    if (!settings.azure_speech_key || !settings.azure_region) {
      errorMessage = "Please configure your Azure Speech key in Settings first.";
      return;
    }

    const micPermission = await checkMicrophonePermission();
    if (micPermission === "denied") {
      errorMessage = "Microphone access was denied. Please allow microphone access in your system settings.";
      return;
    }

    errorMessage = "";
    silenceMessage = "";
    // Feature 1: Do NOT clear text state — preserve existing text across stop/start
    // Only clear interim text since old interim is stale
    interimText = "";
    // Sync the segment count so the $effect doesn't re-process existing segments
    lastSyncedSegmentCount = finalSegments.length;

    const rec = createRecognizer(
      settings.azure_speech_key,
      settings.azure_region,
      settings.languages,
      settings.microphone_device_id || undefined,
      settings.phrase_list,
      settings.auto_punctuation
    );

    const callbacks: SpeechCallbacks = {
      onInterim: (text) => {
        interimText = text;
        resetSilenceTimer();
      },
      onFinal: (text) => {
        if (text) {
          finalSegments = [...finalSegments, text];
          interimText = "";
          resetSilenceTimer();
        }
      },
      onError: (err) => {
        errorMessage = err;
      },
      onStatusChange: (s) => {
        status = s;
        if (s === "listening") {
          sessionStartTime = Date.now();
          resetSilenceTimer();
        }
      },
    };

    startContinuousRecognition(rec, callbacks);
  }

  function clearText() {
    finalSegments = [];
    interimText = "";
    editedText = "";
    userHasEdited = false;
    lastSyncedSegmentCount = 0;
  }

  async function copyAndClose() {
    const text = editedText.trim();
    if (text) {
      await writeText(text);
      // Record history if enabled
      if (settings.history_enabled) {
        await addHistoryEntry(text, settings.history_max_entries);
        historyCount = Math.min(historyCount + 1, settings.history_max_entries);
      }
    }
    // Stop recording if active
    if (status === "listening") {
      await stopAndRecordUsage();
    }
    // Reset state
    clearText();
    errorMessage = "";
    silenceMessage = "";
    status = "idle";
    disposeRecognizer();
    await invoke("hide_popup");
  }

  async function dismiss() {
    if (status === "listening") {
      await stopAndRecordUsage();
    }
    clearText();
    errorMessage = "";
    silenceMessage = "";
    status = "idle";
    disposeRecognizer();
    await invoke("hide_popup");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (historyOpen) {
        historyOpen = false;
      } else {
        dismiss();
      }
    } else if (matchesShortcut(e, settings.popup_copy_shortcut)) {
      copyAndClose();
    } else if (matchesShortcut(e, settings.popup_voice_shortcut)) {
      e.preventDefault();
      toggleMic();
    }
  }

  async function toggleHistoryPanel() {
    if (!historyOpen) {
      historyEntries = await getHistory();
      historyCount = historyEntries.length;
    }
    historyOpen = !historyOpen;
  }

  async function handleHistoryDelete(timestamp: string) {
    await deleteHistoryEntry(timestamp);
    historyEntries = await getHistory();
    historyCount = historyEntries.length;
  }

  function insertHistoryEntry(text: string) {
    editedText = text;
    userHasEdited = true;
    historyOpen = false;
  }

  async function copyHistoryEntry(text: string) {
    await writeText(text);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="popup-container">
  <!-- Custom title bar / drag area -->
  <div class="titlebar" data-tauri-drag-region>
    <span class="title">Developer Voice to Prompt</span>
    <div class="titlebar-buttons">
      {#if settings.history_enabled}
        <button class="history-toggle" onclick={toggleHistoryPanel} class:active={historyOpen}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
          {#if historyCount > 0}
            <span class="history-badge">{historyCount}</span>
          {/if}
        </button>
      {/if}
      <button class="titlebar-btn" onclick={() => invoke('show_settings')} title="Settings">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="titlebar-btn close-btn" onclick={dismiss} title="Close (Esc)">✕</button>
    </div>
  </div>

  <!-- Info bar: languages, phrases, shortcuts -->
  <div class="info-bar">
    <div class="info-row">
      <span class="info-label">Languages:</span>
      {#if settings.languages.length > 0}
        <div class="language-tags">
          {#each settings.languages as code}
            <span class="lang-tag">{code}</span>
          {/each}
        </div>
      {:else}
        <span class="info-value-muted">None configured</span>
      {/if}
      {#if settings.phrase_list.length > 0}
        <span class="info-separator">|</span>
        <span class="info-label">Phrases:</span>
        <span class="phrases-indicator" title={settings.phrase_list.join(', ')}>{settings.phrase_list.length} active</span>
      {/if}
    </div>
    <div class="info-row">
      <span class="info-label">Shortcuts:</span>
      <span class="shortcut-item"><span class="shortcut-action">Show Popup:</span> <kbd>{formatShortcutLabel(settings.shortcut)}</kbd></span>
      <span class="info-separator">&middot;</span>
      <span class="shortcut-item"><span class="shortcut-action">Start / Stop Voice:</span> <kbd>{formatShortcutLabel(settings.popup_voice_shortcut)}</kbd></span>
      <span class="info-separator">&middot;</span>
      <span class="shortcut-item"><span class="shortcut-action">Stop, Copy & Close:</span> <kbd>{formatShortcutLabel(settings.popup_copy_shortcut)}</kbd></span>
      <span class="info-separator">&middot;</span>
      <span class="shortcut-item"><span class="shortcut-action">Dismiss:</span> <kbd>Esc</kbd></span>
    </div>
  </div>

  <div class="content">
    <div class="main-content">
    <!-- Text area for live editing -->
    <div class="text-area">
      <div class="text-header">
        {#if editedText}
          <button class="clear-btn" onclick={clearText} title="Clear text">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Clear
          </button>
        {/if}
      </div>
      <textarea
        bind:this={textareaEl}
        value={editedText}
        oninput={handleTextInput}
        placeholder={!settings.azure_speech_key
          ? "Configure your Azure Speech key in Settings first..."
          : "Your dictated text will appear here..."}
        class:has-interim={interimText && !userHasEdited}
      ></textarea>
    </div>

    <!-- Error message -->
    {#if errorMessage}
      <div class="error">{errorMessage}</div>
    {/if}

    <!-- Silence auto-stop message -->
    {#if silenceMessage}
      <div class="silence-msg">{silenceMessage}</div>
    {/if}

    <!-- Action buttons -->
    <div class="actions">
      <button
        class="btn btn-primary"
        onclick={copyAndClose}
        disabled={!editedText.trim()}
      >
        Stop, Copy & Close
      </button>
    </div>
    <!-- Floating mic button overlapping textarea -->
    <div class="mic-float">
      <MicButton {status} onToggle={toggleMic} />
    </div>
    </div>

    <!-- History side panel (right side) -->
    {#if historyOpen}
      <div class="history-panel">
        <div class="history-header">
          <span class="history-title">History</span>
          <button class="titlebar-btn" onclick={() => historyOpen = false} title="Close history">✕</button>
        </div>
        <div class="history-list">
          {#if historyEntries.length === 0}
            <div class="history-empty">No history yet</div>
          {:else}
            {#each historyEntries as entry}
              <div class="history-entry">
                <button class="history-entry-body" onclick={() => insertHistoryEntry(entry.text)} title="Click to insert">
                  <span class="history-text">{entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text}</span>
                  <span class="history-time">{formatRelativeTime(entry.timestamp)}</span>
                </button>
                <div class="history-entry-actions">
                  <button class="history-action-btn" onclick={() => copyHistoryEntry(entry.text)} title="Copy">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="history-action-btn delete" onclick={() => handleHistoryDelete(entry.timestamp)} title="Delete">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

  </div>
</div>

<style>
  .popup-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-secondary);
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .titlebar-buttons {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .titlebar-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .titlebar-btn:hover {
    background: var(--surface-hover);
    color: var(--accent);
  }

  .history-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 10px;
    border-radius: 6px;
    transition: all 0.15s;
    margin-right: 4px;
    line-height: 1;
  }

  .history-toggle:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  .history-toggle.active {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  .close-btn:hover {
    color: var(--error);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: row;
    padding: 6px 6px;
    gap: 8px;
    min-height: 0;
    position: relative;
  }

  .history-panel {
    width: 260px;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    animation: slideIn 0.15s ease-out;
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }

  .history-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .history-empty {
    padding: 20px 12px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
  }

  .history-entry {
    display: flex;
    align-items: stretch;
    border-radius: 6px;
    margin-bottom: 6px;
    background: var(--surface);
    border: 1px solid var(--border);
    transition: background 0.1s, border-color 0.1s;
  }

  .history-entry:hover {
    background: var(--surface-hover);
    border-color: var(--accent);
  }

  .history-entry-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    min-width: 0;
    color: inherit;
  }

  .history-text {
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.3;
    word-break: break-word;
  }

  .history-time {
    font-size: 10px;
    color: var(--text-muted);
  }

  .history-entry-actions {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 2px 4px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .history-entry:hover .history-entry-actions {
    opacity: 1;
  }

  .history-action-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .history-action-btn:hover {
    background: var(--surface);
    color: var(--accent);
  }

  .history-action-btn.delete:hover {
    color: var(--error);
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding-right: 28px;
    position: relative;
  }

  .info-bar {
    display: flex;
    flex-direction: column;
    padding: 6px 12px;
    margin: 4px 10px 0;
    gap: 3px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .info-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .info-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .info-value-muted {
    font-size: 11px;
    color: var(--text-muted);
  }

  .info-separator {
    font-size: 11px;
    color: var(--text-muted);
  }

  .shortcut-item {
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .shortcut-action {
    font-weight: 600;
    color: var(--text-primary);
  }

  .shortcut-item kbd {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
  }

  .phrases-indicator {
    font-size: 11px;
    color: var(--accent);
    cursor: help;
    text-decoration: underline dotted;
  }

  .phrases-indicator:hover {
    color: var(--accent-hover, var(--accent));
  }

  .history-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .history-toggle.active .history-badge {
    background: var(--bg-primary);
    color: var(--accent);
  }

  .language-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .lang-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--lang-tag-bg);
    color: var(--accent);
    border: 1px solid var(--lang-tag-border);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    white-space: nowrap;
  }

  .text-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .text-header {
    display: flex;
    justify-content: flex-end;
    min-height: 0;
  }

  .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .clear-btn:hover {
    background: var(--surface-hover);
    color: var(--error);
  }

  .silence-msg {
    font-size: 12px;
    color: var(--warning);
    padding: 4px 0;
  }

  textarea {
    width: 100%;
    height: 100%;
    background: var(--input-bg);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    outline: none;
    line-height: 1.5;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  textarea.has-interim {
    border-color: var(--warning);
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  .error {
    font-size: 12px;
    color: var(--error);
    padding: 4px 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mic-float {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 10;
  }

  .mic-float :global(.mic-button) {
    width: 56px;
    height: 56px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  }

  .mic-float :global(.mic-button svg) {
    width: 26px;
    height: 26px;
  }

  .btn {
    padding: 6px 16px;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
