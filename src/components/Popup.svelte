<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import type { AppSettings } from "../lib/settingsStore";
  import {
    SUPPORTED_LANGUAGES,
  } from "../lib/settingsStore";
  import {
    createRecognizer,
    startContinuousRecognition,
    stopContinuousRecognition,
    disposeRecognizer,
    type SpeechCallbacks,
  } from "../lib/speechService";
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

  function handleTextInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    editedText = target.value;
    userHasEdited = true;
  }

  async function toggleMic() {
    if (status === "listening") {
      await stopContinuousRecognition();
      status = "idle";
      return;
    }

    if (!settings.azure_speech_key || !settings.azure_region) {
      errorMessage = "Please configure your Azure Speech key in Settings first.";
      return;
    }

    errorMessage = "";
    finalSegments = [];
    interimText = "";
    userHasEdited = false;
    editedText = "";
    lastSyncedSegmentCount = 0;

    const rec = createRecognizer(
      settings.azure_speech_key,
      settings.azure_region,
      settings.languages,
      settings.microphone_device_id || undefined
    );

    const callbacks: SpeechCallbacks = {
      onInterim: (text) => {
        interimText = text;
      },
      onFinal: (text) => {
        if (text) {
          finalSegments = [...finalSegments, text];
          interimText = "";
        }
      },
      onError: (err) => {
        errorMessage = err;
      },
      onStatusChange: (s) => {
        status = s;
      },
    };

    startContinuousRecognition(rec, callbacks);
  }

  async function copyAndClose() {
    const text = editedText.trim();
    if (text) {
      await writeText(text);
    }
    // Reset state
    finalSegments = [];
    interimText = "";
    editedText = "";
    userHasEdited = false;
    lastSyncedSegmentCount = 0;
    errorMessage = "";
    status = "idle";
    disposeRecognizer();
    await invoke("hide_popup");
  }

  async function dismiss() {
    if (status === "listening") {
      await stopContinuousRecognition();
    }
    finalSegments = [];
    interimText = "";
    editedText = "";
    userHasEdited = false;
    lastSyncedSegmentCount = 0;
    errorMessage = "";
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
    <span class="title">Dictation</span>
    <button class="close-btn" onclick={dismiss} title="Close (Esc)">✕</button>
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

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
  }

  .close-btn:hover {
    background: var(--surface-hover);
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
