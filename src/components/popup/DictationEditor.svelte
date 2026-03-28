<script lang="ts">
  import { onMount } from "svelte";
  import { DictationEditorController } from "../../lib/DictationEditorController";

  // --- Props ---
  interface Props {
    text: string;
    fontFamily: string;
    disabled: boolean;
    recording: boolean;
    oninput?: () => void;
    /** Called when interim text is auto-committed (e.g. cursor move). */
    oncommit?: () => void;
  }

  let { text = $bindable(), fontFamily, disabled, recording, oninput, oncommit }: Props = $props();

  // --- Controller setup ---

  let containerEl: HTMLDivElement | undefined = $state();
  let ctrl: DictationEditorController | undefined = $state();

  onMount(() => {
    if (!containerEl) return;
    ctrl = new DictationEditorController({
      initialDoc: text,
      fontFamily,
      disabled,
      callbacks: {
        onDocChange(newText) {
          text = newText;
          oninput?.();
        },
        onInterimCommit() {
          oncommit?.();
        },
      },
    });
    ctrl.attach(containerEl);
    return () => {
      ctrl?.destroy();
      ctrl = undefined;
    };
  });

  // Sync parent text → controller (when parent changes text externally)
  $effect(() => {
    const _text = text;
    if (!ctrl) return;
    ctrl.setText(_text);
  });

  // Toggle editable when disabled changes
  $effect(() => {
    ctrl?.setDisabled(disabled);
  });

  // Update theme when font changes
  $effect(() => {
    ctrl?.setFontFamily(fontFamily);
  });

  // Keep callbacks in sync when oninput/oncommit change
  $effect(() => {
    ctrl?.setCallbacks({
      onDocChange(newText) {
        text = newText;
        oninput?.();
      },
      onInterimCommit() {
        oncommit?.();
      },
    });
  });

  // --- Public API (delegates to controller, called from Popup.svelte) ---

  export function insertInterim(newInterim: string) {
    ctrl?.insertInterim(newInterim);
    if (ctrl) text = ctrl.getText();
  }

  export function commitInterim(): { text: string; from: number; to: number } | null {
    return ctrl?.commitInterim() ?? null;
  }

  export function finalizeInterim(finalText: string) {
    ctrl?.finalizeInterim(finalText);
    if (ctrl) text = ctrl.getText();
  }

  export function getCommittedText(): string {
    return ctrl?.getCommittedText() ?? text;
  }

  export function getAnchor(): number {
    return ctrl?.getAnchor() ?? 0;
  }

  export function isInsertingAtCursor(): boolean {
    return ctrl?.isInsertingAtCursor() ?? false;
  }

  export function setCursorEnd() {
    ctrl?.setCursorEnd();
  }

  export function focus() {
    ctrl?.focus();
  }

  export function focusAtEnd() {
    ctrl?.focusAtEnd();
  }

  export function scrollToBottom() {
    ctrl?.scrollToBottom();
  }

  export function resetAnchorToEnd() {
    ctrl?.resetAnchorToEnd();
  }

  export function snapAnchorToEnd() {
    ctrl?.snapAnchorToEnd();
  }

  export function getDocLength(): number {
    return ctrl?.getDocLength() ?? text.length;
  }

  export function hasInterim(): boolean {
    return ctrl?.hasInterim() ?? false;
  }
</script>

<div
  class="dictation-editor"
  class:recording
  class:disabled
  bind:this={containerEl}
></div>

<style>
  .dictation-editor {
    width: 100%;
    height: 100%;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .dictation-editor:focus-within {
    border-color: var(--accent);
  }

  .dictation-editor.recording {
    border-color: var(--recording);
    box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 8%, transparent);
    animation: recordingGlow 2s ease-in-out infinite;
  }

  @keyframes recordingGlow {
    0%, 100% { box-shadow: 0 0 0 2px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 8%, transparent); }
    50% { box-shadow: 0 0 0 4px var(--recording-glow), inset 0 0 0 1px color-mix(in srgb, var(--recording) 15%, transparent); }
  }

  .dictation-editor.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  /* CM6 internal overrides */
  .dictation-editor :global(.cm-editor) {
    height: 100%;
    background: transparent;
  }
  .dictation-editor :global(.cm-scroller) {
    overflow: auto;
  }
</style>
