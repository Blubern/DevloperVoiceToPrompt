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
    createSpeechProvider,
    checkMicrophonePermission,
    webSpeechAvailable,
    type SpeechCallbacks,
    type SpeechProvider,
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
  let activeProvider: SpeechProvider | null = null;

  // Silence auto-stop timer
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceMessage = $state("");
  let silenceMessageFading = $state(false);

  // Window resize/move debounce
  let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

  // History panel
  let historyOpen = $state(false);
  let historyEntries = $state<HistoryEntry[]>([]);
  let historyCount = $state(0);
  let historySearch = $state("");

  let filteredHistoryEntries = $derived(
    historySearch.trim()
      ? historyEntries.filter(e => e.text.toLowerCase().includes(historySearch.trim().toLowerCase()))
      : historyEntries
  );

  // Help overlay
  let helpOpen = $state(false);

  // Copied toast
  let showCopiedToast = $state(false);

  // Undo clear
  let undoSnapshot: { segments: string[]; text: string; wasEdited: boolean; syncCount: number } | null = $state(null);
  let showUndoToast = $state(false);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  // Elapsed time display
  let elapsedSeconds = $state(0);
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  // Auto-scroll tracking
  let userScrolledUp = false;

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

  // Language labels for display: "Name (code)" format
  let languageDisplayLabels = $derived(
    settings.languages.map((code) => {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === code);
      return lang ? `${lang.label.split(" ")[0]} (${code})` : code;
    })
  );

  // OS language display label
  let osLanguageDisplayLabel = $derived(() => {
    const lang = SUPPORTED_LANGUAGES.find((l) => l.code === settings.os_language);
    return lang ? `${lang.label.split(" ")[0]} (${settings.os_language})` : settings.os_language;
  });

  // Context-aware button label
  let primaryButtonLabel = $derived.by(() => {
    const hasText = editedText.trim().length > 0;
    if (status === "listening" && hasText) return "Stop, Copy & Close";
    if (status === "listening" && !hasText) return "Stop Recording";
    if (hasText) return "Copy & Close";
    return "Copy & Close";
  });

  // Format elapsed time as m:ss
  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  $effect(() => {
    const segmentCount = finalSegments.length;
    const currentInterim = interimText;

    if (!userHasEdited) {
      editedText =
        finalSegments.join(" ") +
        (currentInterim ? (segmentCount ? " " : "") + currentInterim : "");
      lastSyncedSegmentCount = segmentCount;
    } else if (segmentCount > lastSyncedSegmentCount) {
      const newSegments = finalSegments.slice(lastSyncedSegmentCount);
      if (newSegments.length > 0) {
        const addition = newSegments.join(" ");
        editedText = editedText.trimEnd() + " " + addition;
      }
      lastSyncedSegmentCount = segmentCount;
    }
  });

  // Auto-scroll textarea to bottom on new text
  $effect(() => {
    // Track editedText changes
    const _ = editedText;
    if (textareaEl && !userScrolledUp) {
      requestAnimationFrame(() => {
        if (textareaEl) {
          textareaEl.scrollTop = textareaEl.scrollHeight;
        }
      });
    }
  });

  // Track if user scrolled up manually
  function handleTextareaScroll() {
    if (!textareaEl) return;
    const { scrollTop, scrollHeight, clientHeight } = textareaEl;
    userScrolledUp = scrollHeight - scrollTop - clientHeight > 30;
  }

  // Elapsed timer for recording state
  $effect(() => {
    if (status === "listening") {
      elapsedSeconds = 0;
      elapsedInterval = setInterval(() => {
        elapsedSeconds += 1;
      }, 1000);
    } else {
      if (elapsedInterval) {
        clearInterval(elapsedInterval);
        elapsedInterval = null;
      }
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
        silenceMessage = `Auto-paused after ${timeout}s of silence`;
        silenceMessageFading = false;
        await stopAndRecordUsage();
        setTimeout(() => {
          silenceMessageFading = true;
          setTimeout(() => { silenceMessage = ""; silenceMessageFading = false; }, 500);
        }, 3500);
      }, timeout * 1000);
    }
  }

  async function stopAndRecordUsage() {
    if (activeProvider) {
      await activeProvider.stop();
      activeProvider.dispose();
      activeProvider = null;
    }
    status = "idle";
    clearSilenceTimer();
    if (sessionStartTime !== null) {
      const elapsed = (Date.now() - sessionStartTime) / 1000;
      sessionStartTime = null;
      await recordUsage(elapsed, settings.speech_provider as "os" | "azure");
    }
  }

  async function toggleMic() {
    if (status === "listening") {
      await stopAndRecordUsage();
      return;
    }

    if (settings.speech_provider === "azure" && (!settings.azure_speech_key || !settings.azure_region)) {
      errorMessage = "Azure Speech key not configured. Go to Settings → Speech.";
      return;
    }

    if (settings.speech_provider === "os" && !webSpeechAvailable) {
      errorMessage = "Web Speech API is not available in this browser.";
      return;
    }

    const micPermission = await checkMicrophonePermission();
    if (micPermission === "denied") {
      errorMessage = "Microphone access denied. Check system privacy settings.";
      return;
    }

    errorMessage = "";
    silenceMessage = "";
    interimText = "";
    lastSyncedSegmentCount = finalSegments.length;
    userScrolledUp = false;

    const provider = createSpeechProvider(settings);

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

    activeProvider = provider;
    provider.start(callbacks);
  }

  function clearText() {
    // Save snapshot for undo
    if (editedText.trim()) {
      undoSnapshot = {
        segments: [...finalSegments],
        text: editedText,
        wasEdited: userHasEdited,
        syncCount: lastSyncedSegmentCount,
      };
      showUndoToast = true;
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        showUndoToast = false;
        undoSnapshot = null;
      }, 4000);
    }
    finalSegments = [];
    interimText = "";
    editedText = "";
    userHasEdited = false;
    lastSyncedSegmentCount = 0;
    userScrolledUp = false;
  }

  function undoClear() {
    if (!undoSnapshot) return;
    finalSegments = undoSnapshot.segments;
    editedText = undoSnapshot.text;
    userHasEdited = true;
    lastSyncedSegmentCount = undoSnapshot.syncCount;
    undoSnapshot = null;
    showUndoToast = false;
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
  }

  async function copyToClipboard() {
    const text = editedText.trim();
    if (!text) return;
    await writeText(text);
    showCopiedToast = true;
    setTimeout(() => { showCopiedToast = false; }, 1800);
  }

  async function copyAndClose() {
    const text = editedText.trim();
    if (text) {
      await writeText(text);
      if (settings.history_enabled) {
        await addHistoryEntry(text, settings.history_max_entries);
        // Refresh history if panel is open
        if (historyOpen) {
          historyEntries = await getHistory();
        }
        historyCount = Math.min(historyCount + 1, settings.history_max_entries);
      }
    }
    if (status === "listening") {
      await stopAndRecordUsage();
    }
    clearText();
    errorMessage = "";
    silenceMessage = "";
    status = "idle";
    if (activeProvider) { activeProvider.dispose(); activeProvider = null; }
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
    if (activeProvider) { activeProvider.dispose(); activeProvider = null; }
    await invoke("hide_popup");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (helpOpen) {
        helpOpen = false;
      } else if (historyOpen) {
        historyOpen = false;
      } else {
        dismiss();
      }
    } else if (matchesShortcut(e, settings.popup_copy_shortcut)) {
      copyAndClose();
    } else if (matchesShortcut(e, settings.popup_voice_shortcut)) {
      e.preventDefault();
      toggleMic();
    } else if (matchesShortcut(e, settings.provider_switch_shortcut)) {
      e.preventDefault();
      if (status !== "listening") {
        settings = { ...settings, speech_provider: settings.speech_provider === "os" ? "azure" : "os" };
      }
    }
  }

  async function toggleHistoryPanel() {
    if (!historyOpen) {
      historyEntries = await getHistory();
      historyCount = historyEntries.length;
      historySearch = "";
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
  <!-- Compact title bar -->
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-left" data-tauri-drag-region>
      <span class="title" data-tauri-drag-region>Developer Voice to Prompt</span>
      <button
        class="provider-toggle"
        onclick={() => {
          if (status !== "listening") {
            settings = { ...settings, speech_provider: settings.speech_provider === "os" ? "azure" : "os" };
          }
        }}
        disabled={status === "listening"}
        title={settings.speech_provider === "os" ? "Using Web Speech — click to switch to Azure" : "Using Azure — click to switch to Web Speech"}
      >
        {settings.speech_provider === "os" ? "Web" : "Azure"}
      </button>
      {#if settings.speech_provider === "azure" && settings.languages.length > 0}
        <span class="lang-indicator" title={languageDisplayLabels.join(', ')}>{languageDisplayLabels.join(' · ')}</span>
      {:else if settings.speech_provider === "os"}
        <span class="lang-indicator" title={settings.os_language}>{osLanguageDisplayLabel()}</span>
      {/if}
    </div>
    <div class="titlebar-buttons">
      {#if settings.history_enabled}
        <button
          class="history-toggle"
          onclick={toggleHistoryPanel}
          class:active={historyOpen}
          aria-label="Toggle history"
          aria-pressed={historyOpen}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          History
          {#if historyCount > 0}
            <span class="history-badge">{historyCount}</span>
          {/if}
        </button>
      {/if}
      <button class="titlebar-btn" onclick={() => helpOpen = !helpOpen} aria-label="Keyboard shortcuts" title="Keyboard shortcuts">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </button>
      <button class="titlebar-btn" onclick={() => invoke('show_settings')} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="titlebar-btn close-btn" onclick={dismiss} aria-label="Close" title="Close (Esc)">✕</button>
    </div>
  </div>

  <!-- Help overlay (keyboard shortcuts) -->
  {#if helpOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="help-backdrop" onclick={() => helpOpen = false}></div>
    <div class="help-overlay">
      <div class="help-title">Keyboard Shortcuts</div>
      <div class="help-grid">
        <span class="help-action">Show Popup</span>
        <kbd>{formatShortcutLabel(settings.shortcut)}</kbd>
        <span class="help-action">Start / Stop Voice</span>
        <kbd>{formatShortcutLabel(settings.popup_voice_shortcut)}</kbd>
        <span class="help-action">Copy & Close</span>
        <kbd>{formatShortcutLabel(settings.popup_copy_shortcut)}</kbd>
        <span class="help-action">Dismiss</span>
        <kbd>Esc</kbd>
      </div>
      {#if settings.phrase_list.length > 0}
        <div class="help-extra">
          <span class="help-extra-label">Custom phrases:</span> {settings.phrase_list.length} active
        </div>
      {/if}
      <div class="help-tip">Pro tip: Do everything via keyboard — no mouse needed.</div>
    </div>
  {/if}

  <div class="content">
    <div class="main-content">
      <!-- Recording status bar -->
      {#if status === "listening"}
        <div class="recording-bar">
          <span class="rec-dot"></span>
          <span class="rec-label">Listening...</span>
          <span class="rec-elapsed">{formatElapsed(elapsedSeconds)}</span>
        </div>
      {/if}

      <!-- Text area for live editing -->
      <div class="text-area">
        {#if !editedText && status === "idle"}
          <!-- Guided empty state -->
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            {#if settings.speech_provider === "azure" && !settings.azure_speech_key}
              <span class="empty-state-text">Configure your Azure Speech key in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button> to get started</span>
            {:else if settings.speech_provider === "os" && !webSpeechAvailable}
              <span class="empty-state-text">Web Speech API is not available. Switch to Azure in <button class="link-btn" onclick={() => invoke('show_settings')}>Settings</button></span>
            {:else}
              <span class="empty-state-text">Click the mic or press <kbd>{formatShortcutLabel(settings.popup_voice_shortcut)}</kbd> to start</span>
            {/if}
          </div>
        {/if}

        <textarea
          bind:this={textareaEl}
          value={editedText}
          oninput={handleTextInput}
          onscroll={handleTextareaScroll}
          class:recording={status === "listening"}
          class:hidden-textarea={!editedText && status === "idle"}
        ></textarea>

        <!-- Floating mic button anchored to textarea -->
        <div class="mic-float">
          <MicButton {status} onToggle={toggleMic} />
        </div>
      </div>

      <!-- Error message with action -->
      {#if errorMessage}
        <div class="error-bar">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span class="error-text">{errorMessage}</span>
          {#if errorMessage.includes("key") || errorMessage.includes("configured")}
            <button class="error-action" onclick={() => invoke('show_settings')}>Open Settings</button>
          {/if}
        </div>
      {/if}

      <!-- Silence auto-stop message -->
      {#if silenceMessage}
        <div class="silence-msg" class:fading={silenceMessageFading}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {silenceMessage}
        </div>
      {/if}

      <!-- Action buttons -->
      <div class="actions">
        {#if editedText.trim() || status === "listening"}
          <button
            class="btn btn-primary"
            onclick={copyAndClose}
            disabled={!editedText.trim() && status !== "listening"}
          >
            {primaryButtonLabel}
          </button>
          {#if editedText.trim() && status !== "listening"}
            <button class="btn btn-secondary" onclick={copyToClipboard} aria-label="Copy to clipboard" title="Copy to clipboard">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button class="btn btn-secondary" onclick={clearText} aria-label="Clear text" title="Clear text">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          {/if}
        {/if}
      </div>

      <!-- Copied toast -->
      {#if showCopiedToast}
        <div class="copied-toast">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Copied!
        </div>
      {/if}

      <!-- Undo clear toast -->
      {#if showUndoToast}
        <div class="undo-toast">
          Text cleared
          <button class="undo-btn" onclick={undoClear}>Undo</button>
        </div>
      {/if}

    </div>

    <!-- History side panel -->
    {#if historyOpen}
      <div class="history-panel">
        <div class="history-header">
          <span class="history-title">History</span>
          <button class="titlebar-btn" onclick={() => historyOpen = false} aria-label="Close history" title="Close history">✕</button>
        </div>
        <div class="history-search">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            class="history-search-input"
            type="text"
            placeholder="Search history..."
            bind:value={historySearch}
          />
          {#if historySearch}
            <button class="history-search-clear" onclick={() => historySearch = ""} aria-label="Clear search">✕</button>
          {/if}
        </div>
        <div class="history-list">
          {#if filteredHistoryEntries.length === 0}
            <div class="history-empty">{historyEntries.length === 0 ? 'No history yet' : 'No matches'}</div>
          {:else}
            {#each filteredHistoryEntries as entry}
              <div class="history-entry">
                <button class="history-entry-body" onclick={() => insertHistoryEntry(entry.text)} title={entry.text}>
                  <span class="history-text">{entry.text.length > 80 ? entry.text.slice(0, 80) + '…' : entry.text}</span>
                  <span class="history-time">{formatRelativeTime(entry.timestamp)}</span>
                </button>
                <div class="history-entry-actions">
                  <button class="history-action-btn" onclick={() => insertHistoryEntry(entry.text)} aria-label="Insert" title="Insert into text">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                  </button>
                  <button class="history-action-btn" onclick={() => copyHistoryEntry(entry.text)} aria-label="Copy" title="Copy to clipboard">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button class="history-action-btn delete" onclick={() => handleHistoryDelete(entry.timestamp)} aria-label="Delete" title="Delete">
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

  /* ---- Titlebar ---- */
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

  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 0;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    line-height: 1;
  }

  .lang-indicator {
    font-size: 10px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--lang-tag-bg);
    border: 1px solid var(--lang-tag-border);
    cursor: help;
    display: inline-flex;
    align-items: center;
    line-height: 1;
    vertical-align: middle;
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .provider-toggle {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    cursor: pointer;
    line-height: 1;
    vertical-align: middle;
    transition: all 0.15s;
  }

  .provider-toggle:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .provider-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .close-btn:hover {
    color: var(--error);
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

  /* ---- Help Overlay ---- */
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
  }

  .help-overlay {
    position: absolute;
    top: 44px;
    right: 50px;
    z-index: 100;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 18px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    animation: fadeIn 0.12s ease-out;
    min-width: 240px;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .help-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
  }

  .help-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 16px;
    align-items: center;
  }

  .help-action {
    font-size: 12px;
    color: var(--text-primary);
  }

  .help-grid kbd {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
    white-space: nowrap;
  }

  .help-extra {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--text-secondary);
  }

  .help-extra-label {
    font-weight: 600;
    color: var(--text-primary);
  }

  .help-tip {
    margin-top: 8px;
    font-size: 10px;
    color: var(--text-muted);
    font-style: italic;
  }

  /* ---- Content Layout ---- */
  .content {
    flex: 1;
    display: flex;
    flex-direction: row;
    padding: 6px 6px;
    gap: 8px;
    min-height: 0;
    position: relative;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    position: relative;
  }

  /* ---- Recording Status Bar ---- */
  .recording-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--recording-glow);
    border: 1px solid rgba(243, 139, 168, 0.2);
    animation: fadeIn 0.15s ease-out;
  }

  .rec-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--recording);
    animation: recPulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes recPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--recording);
  }

  .rec-elapsed {
    font-size: 11px;
    color: var(--text-muted);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    margin-left: auto;
  }

  /* ---- Text Area ---- */
  .text-area {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
    padding-right: 28px;
  }

  /* Empty state CTA */
  .empty-state {
    position: absolute;
    inset: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    pointer-events: none;
    z-index: 1;
  }

  .empty-state-icon {
    color: var(--text-muted);
  }

  .empty-state-text {
    font-size: 13px;
    color: var(--text-muted);
    text-align: center;
    pointer-events: auto;
  }

  .empty-state-text kbd {
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-family: "SF Mono", "Cascadia Code", "Consolas", monospace;
    font-weight: 600;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
    padding: 0;
  }

  .link-btn:hover {
    color: var(--accent-hover);
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
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  textarea:focus {
    border-color: var(--accent);
  }

  textarea.recording {
    border-color: var(--recording);
    box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px rgba(243, 139, 168, 0.08);
    animation: recordingGlow 2s ease-in-out infinite;
  }

  @keyframes recordingGlow {
    0%, 100% { box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px rgba(243, 139, 168, 0.08); }
    50% { box-shadow: 0 0 0 4px var(--recording-glow), inset 0 0 0 1px rgba(243, 139, 168, 0.15); }
  }

  textarea.hidden-textarea {
    color: transparent;
  }

  textarea::placeholder {
    color: var(--text-muted);
  }

  /* ---- Error Bar ---- */
  .error-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: 12px;
    animation: fadeIn 0.15s ease-out;
  }

  .error-text {
    flex: 1;
  }

  .error-action {
    background: none;
    border: 1px solid var(--error-border);
    color: var(--error);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .error-action:hover {
    background: var(--error-border);
  }

  /* ---- Silence Message ---- */
  .silence-msg {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--warning);
    padding: 5px 10px;
    border-radius: 6px;
    background: var(--warning-bg);
    border: 1px solid rgba(249, 226, 175, 0.15);
    transition: opacity 0.5s;
  }

  .silence-msg.fading {
    opacity: 0;
  }

  /* ---- Actions ---- */
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 16px;
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

  .btn-secondary {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 6px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-secondary:hover {
    background: var(--surface-hover);
    color: var(--accent);
    border-color: var(--accent);
  }

  /* ---- Copied Toast ---- */
  .copied-toast {
    position: absolute;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--success);
    color: var(--bg-primary);
    font-size: 12px;
    font-weight: 600;
    padding: 5px 14px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 5px;
    z-index: 20;
    animation: toastIn 0.2s ease-out;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  @keyframes toastIn {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .undo-toast {
    position: absolute;
    bottom: 72px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    padding: 5px 10px 5px 14px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 20;
    animation: toastIn 0.2s ease-out;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    border: 1px solid var(--border);
  }

  .undo-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .undo-btn:hover {
    background: var(--lang-tag-bg);
    text-decoration: underline;
  }

  /* ---- Floating Mic ---- */
  .mic-float {
    position: absolute;
    right: 3px;
    bottom: -21px;
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

  /* ---- History Panel ---- */
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
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
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

  .history-search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }

  .history-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 11px;
    font-family: inherit;
    padding: 0;
  }

  .history-search-input::placeholder {
    color: var(--text-muted);
  }

  .history-search-clear {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
    padding: 0 2px;
    line-height: 1;
  }

  .history-search-clear:hover {
    color: var(--text-primary);
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
</style>
