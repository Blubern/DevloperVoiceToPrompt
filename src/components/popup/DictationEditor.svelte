<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState, Compartment, type Extension } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import {
    interimField,
    interimExtensions,
    insertInterim as doInsertInterim,
    commitInterim as doCommitInterim,
    finalizeInterim as doFinalizeInterim,
    getCommittedText as doGetCommittedText,
    isInsertingAtCursor as doIsInsertingAtCursor,
  } from "../../lib/dictationEditorState";

  // --- Props ---
  interface Props {
    text: string;
    fontFamily: string;
    disabled: boolean;
    recording: boolean;
    oninput?: () => void;
  }

  let { text = $bindable(), fontFamily, disabled, recording, oninput }: Props = $props();

  // --- CM6 setup ---

  let containerEl: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state();

  /** Compartments for dynamically reconfigurable extensions. */
  const themeCompartment = new Compartment();
  const editableCompartment = new Compartment();

  /** Track whether we're dispatching a programmatic change (to avoid feedback loops). */
  let updatingFromProp = false;
  let updatingFromCM = false;

  /** Dictation anchor: position where speech text is inserted. Reactive so Popup's $derived can track it. */
  let dictationAnchor = $state(0);

  function buildTheme(font: string): Extension {
    return EditorView.theme({
      "&": {
        fontSize: "14px",
        height: "100%",
        flex: "1",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-content": {
        fontFamily: font,
        lineHeight: "1.5",
        padding: "10px",
        caretColor: "var(--text-primary)",
        minHeight: "100%",
      },
      ".cm-scroller": {
        overflow: "auto",
        height: "100%",
      },
      ".cm-line": {
        padding: "0",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent) !important",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text-primary)",
      },
      ".interim-text": {
        color: "var(--accent)",
        opacity: "0.75",
        fontStyle: "italic",
        borderBottom: "1px dotted var(--accent)",
      },
    });
  }

  function buildExtensions(font: string): Extension[] {
    return [
      themeCompartment.of(buildTheme(font)),
      ...interimExtensions(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      editableCompartment.of(EditorView.editable.of(!disabled)),
      // Sync CM6 → parent text on every doc change
      EditorView.updateListener.of((update) => {
        if (updatingFromProp) return;
        if (update.docChanged) {
          updatingFromCM = true;
          text = update.state.doc.toString();
          updatingFromCM = false;
          oninput?.();
        }
        // Track cursor moves: auto-commit interim if cursor leaves the range,
        // and always update dictationAnchor so new speech inserts at the cursor.
        if (update.selectionSet && !update.docChanged) {
          const st = update.state;
          const range = st.field(interimField);
          if (range) {
            autoCommitOnCursorMove(st);
          } else {
            // No interim — update anchor to follow cursor clicks
            dictationAnchor = st.selection.main.head;
          }
        }
      }),
    ];
  }

  onMount(() => {
    if (!containerEl) return;
    const state = EditorState.create({
      doc: text,
      extensions: buildExtensions(fontFamily),
    });
    view = new EditorView({
      state,
      parent: containerEl,
    });
    dictationAnchor = text.length;
    return () => {
      view?.destroy();
      view = undefined;
    };
  });

  // Sync parent text → CM6 (when parent changes text externally)
  $effect(() => {
    const _text = text;
    if (!view || updatingFromCM) return;
    const currentDoc = view.state.doc.toString();
    if (_text !== currentDoc) {
      updatingFromProp = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: _text },
      });
      updatingFromProp = false;
    }
  });

  // Toggle editable when disabled changes, update theme when font changes
  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
        themeCompartment.reconfigure(buildTheme(fontFamily)),
      ],
    });
  });

  // --- Auto-commit on cursor move ---

  function autoCommitOnCursorMove(state: EditorState) {
    const range = state.field(interimField);
    if (!range) return;
    const cursor = state.selection.main.head;
    // If cursor is within the interim range, don't commit
    if (cursor >= range.from && cursor <= range.to) return;
    // Commit: clear the decoration, anchor moves to cursor
    commitInterim();
    dictationAnchor = cursor;
  }

  // --- Public API (called from Popup.svelte) ---

  /**
   * Insert or replace interim text at the dictation anchor.
   * The text gets the .interim-text decoration.
   */
  export function insertInterim(newInterim: string) {
    if (!view) return;
    updatingFromProp = true;
    dictationAnchor = doInsertInterim({ view, anchor: dictationAnchor }, newInterim);
    text = view.state.doc.toString();
    updatingFromProp = false;
  }

  /**
   * Commit interim text: remove decoration, text stays in the document.
   * Returns the committed text range for logging purposes.
   */
  export function commitInterim(): { text: string; from: number; to: number } | null {
    if (!view) return null;
    updatingFromProp = true;
    const result = doCommitInterim(view);
    updatingFromProp = false;
    if (result) {
      dictationAnchor = result.newAnchor;
      return { text: result.text, from: result.from, to: result.to };
    }
    return null;
  }

  /**
   * Finalize interim text in-place: replace the interim range content with
   * the provider's final text (may differ from interim, e.g. punctuation
   * corrections), clear the decoration, and advance the anchor.
   * If no interim range exists, falls back to inserting at the dictation anchor.
   */
  export function finalizeInterim(finalText: string) {
    if (!view) return;
    updatingFromProp = true;
    dictationAnchor = doFinalizeInterim({ view, anchor: dictationAnchor }, finalText);
    text = view.state.doc.toString();
    updatingFromProp = false;
  }

  /**
   * Get text with interim stripped (for copy/submit).
   */
  export function getCommittedText(): string {
    if (!view) return text;
    return doGetCommittedText(view);
  }

  /**
   * Get the current dictation anchor position.
   */
  export function getAnchor(): number {
    return dictationAnchor;
  }

  /**
   * Check if dictation anchor is before doc end (inserting mid-text).
   * Excludes interim text — if the only content after the anchor is the
   * decorated interim range, we're appending (not inserting mid-text).
   */
  export function isInsertingAtCursor(): boolean {
    if (!view) return dictationAnchor < text.length;
    return doIsInsertingAtCursor(view, dictationAnchor);
  }

  /**
   * Set cursor and anchor to end of document.
   */
  export function setCursorEnd() {
    if (!view) return;
    const len = view.state.doc.length;
    view.dispatch({
      selection: { anchor: len },
      scrollIntoView: true,
    });
    dictationAnchor = len;
  }

  /**
   * Focus the editor.
   */
  export function focus() {
    view?.focus();
  }

  /**
   * Focus the editor and place cursor at end.
   */
  export function focusAtEnd() {
    if (!view) return;
    const len = view.state.doc.length;
    view.dispatch({
      selection: { anchor: len },
      scrollIntoView: true,
    });
    dictationAnchor = len;
    view.focus();
  }

  /**
   * Scroll to the bottom of the editor.
   */
  export function scrollToBottom() {
    if (!view) return;
    view.dispatch({ scrollIntoView: true });
  }

  /**
   * Reset dictation anchor to end of document (e.g. before new recording session).
   */
  export function resetAnchorToEnd() {
    if (!view) return;
    dictationAnchor = view.state.doc.length;
  }

  /**
   * Snap anchor to end + move cursor there (for "resume appending" action).
   */
  export function snapAnchorToEnd() {
    if (!view) return;
    const len = view.state.doc.length;
    dictationAnchor = len;
    view.dispatch({
      selection: { anchor: len },
    });
  }

  /**
   * Get the document length.
   */
  export function getDocLength(): number {
    return view?.state.doc.length ?? text.length;
  }

  /**
   * Check if there's a pending interim range.
   */
  export function hasInterim(): boolean {
    if (!view) return false;
    return view.state.field(interimField) !== null;
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
