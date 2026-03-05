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
        const s: Store = await load("settings.json");
        await s.set("popup_width", size.width / (await win.scaleFactor()));
        await s.set("popup_height", size.height / (await win.scaleFactor()));
        await s.set("popup_x", pos.x / (await win.scaleFactor()));
        await s.set("popup_y", pos.y / (await win.scaleFactor()));
      } catch {}
    }

    function debouncedSave() {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(saveGeometry, 300);
    }

    win.onResized(() => debouncedSave()).then((u) => unlisteners.push(u));
    win.onMoved(() => debouncedSave()).then((u) => unlisteners.push(u));

    return () => {
      unlisteners.forEach((u) => u());
      if (resizeDebounce) clearTimeout(resizeDebounce);
    };
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
      dismiss();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      copyAndClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="popup-container">
  <!-- Custom title bar / drag area -->
  <div class="titlebar" data-tauri-drag-region>
    <span class="title">Developer Voice to Prompt</span>
    <div class="titlebar-buttons">
      <button class="titlebar-btn" onclick={() => invoke('show_settings')} title="Settings">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
      <button class="titlebar-btn close-btn" onclick={dismiss} title="Close (Esc)">✕</button>
    </div>
  </div>

  <div class="content">
    <!-- Microphone button -->
    <div class="mic-area">
      <MicButton {status} onToggle={toggleMic} />
      <div class="mic-info">
        <span class="status-label">
          {#if status === "listening"}
            Listening...
          {:else if status === "error"}
            Error
          {:else if !settings.azure_speech_key}
            Setup required
          {:else}
            Click to start
          {/if}
        </span>
        {#if settings.languages.length > 0}
          <div class="language-tags">
            {#each settings.languages as code}
              <span class="lang-tag">{code}</span>
            {/each}
          </div>
        {/if}
      </div>
    </div>

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
        Copy & Close
      </button>
      <span class="hint">Ctrl+Enter to copy · Esc to dismiss</span>
    </div>
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

  .close-btn:hover {
    color: var(--error);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px 16px;
    gap: 10px;
    min-height: 0;
  }

  .mic-area {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .mic-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .status-label {
    font-size: 13px;
    color: var(--text-secondary);
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
    min-height: 22px;
    margin-bottom: 2px;
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
    justify-content: space-between;
    gap: 8px;
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

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
