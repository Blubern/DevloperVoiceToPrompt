// ---------------------------------------------------------------------------
// Headless controller for the CM6 dictation editor.
//
// Owns the EditorView, compartments, dictation anchor, and all public methods
// that were previously trapped inside DictationEditor.svelte.  The Svelte
// component becomes a thin shell that creates this controller and forwards
// prop changes.  The controller can be instantiated in unit tests without
// Svelte or a real DOM (CM6 works fine in jsdom).
//
// Pure CM6 state operations are delegated to dictationEditorState.ts —
// this class adds the orchestration layer (feedback-loop guards, anchor
// tracking on cursor moves, compartment toggling, auto-commit).
// ---------------------------------------------------------------------------

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
} from "./dictationEditorState";

// --- Public types ---

export interface DictationEditorCallbacks {
  /** Fires when the user changes the document (typing, paste, delete). */
  onDocChange?: (newText: string) => void;
  /** Fires when interim text is auto-committed because the cursor moved. */
  onInterimCommit?: () => void;
}

export interface DictationEditorOptions {
  initialDoc?: string;
  fontFamily?: string;
  disabled?: boolean;
  callbacks?: DictationEditorCallbacks;
}

// --- Controller ---

export class DictationEditorController {
  private view: EditorView | undefined;
  private themeCompartment = new Compartment();
  private editableCompartment = new Compartment();

  /** Guards to prevent feedback loops between external setText and CM6 updates. */
  private updatingFromExternal = false;
  private updatingFromCM = false;

  private _dictationAnchor = 0;
  private callbacks: DictationEditorCallbacks;
  private _fontFamily: string;
  private _disabled: boolean;

  constructor(opts: DictationEditorOptions = {}) {
    this._fontFamily = opts.fontFamily ?? "monospace";
    this._disabled = opts.disabled ?? false;
    this.callbacks = opts.callbacks ?? {};

    const doc = opts.initialDoc ?? "";
    const state = EditorState.create({
      doc,
      extensions: this.buildExtensions(this._fontFamily, this._disabled),
    });
    this.view = new EditorView({ state });
    this._dictationAnchor = doc.length;
  }

  // --- Lifecycle ---

  /** Mount the editor into a DOM container. */
  attach(container: HTMLElement): void {
    if (!this.view) return;
    container.appendChild(this.view.dom);
  }

  /** Destroy the editor view and release resources. */
  destroy(): void {
    this.view?.destroy();
    this.view = undefined;
  }

  /** Whether the controller has a live EditorView. */
  get alive(): boolean {
    return this.view !== undefined;
  }

  // --- External setters (driven by Svelte props / tests) ---

  /** Replace the entire document content (external sync). */
  setText(newText: string): void {
    if (!this.view || this.updatingFromCM) return;
    const currentDoc = this.view.state.doc.toString();
    if (newText === currentDoc) return;
    this.updatingFromExternal = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: newText },
    });
    this.updatingFromExternal = false;
  }

  /** Update the font family (reconfigures CM6 theme compartment). */
  setFontFamily(font: string): void {
    if (!this.view) return;
    this._fontFamily = font;
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(this.buildTheme(font)),
    });
  }

  /** Toggle editable state (reconfigures CM6 editable compartment). */
  setDisabled(disabled: boolean): void {
    if (!this.view) return;
    this._disabled = disabled;
    this.view.dispatch({
      effects: this.editableCompartment.reconfigure(
        EditorView.editable.of(!disabled),
      ),
    });
  }

  /** Replace the callback bag (e.g. when Svelte props change). */
  setCallbacks(cb: DictationEditorCallbacks): void {
    this.callbacks = cb;
  }

  // --- Dictation anchor ---

  get dictationAnchor(): number {
    return this._dictationAnchor;
  }

  // --- Public API (matches the 15 exports from DictationEditor.svelte) ---

  insertInterim(newInterim: string): void {
    if (!this.view) return;
    this.updatingFromExternal = true;
    this._dictationAnchor = doInsertInterim(
      { view: this.view, anchor: this._dictationAnchor },
      newInterim,
    );
    this.updatingFromExternal = false;
  }

  commitInterim(): { text: string; from: number; to: number } | null {
    if (!this.view) return null;
    this.updatingFromExternal = true;
    const result = doCommitInterim(this.view);
    this.updatingFromExternal = false;
    if (result) {
      this._dictationAnchor = result.newAnchor;
      return { text: result.text, from: result.from, to: result.to };
    }
    return null;
  }

  finalizeInterim(finalText: string): void {
    if (!this.view) return;
    this.updatingFromExternal = true;
    this._dictationAnchor = doFinalizeInterim(
      { view: this.view, anchor: this._dictationAnchor },
      finalText,
    );
    this.updatingFromExternal = false;
  }

  getCommittedText(): string {
    if (!this.view) return "";
    return doGetCommittedText(this.view);
  }

  getAnchor(): number {
    return this._dictationAnchor;
  }

  isInsertingAtCursor(): boolean {
    if (!this.view) return false;
    return doIsInsertingAtCursor(this.view, this._dictationAnchor);
  }

  setCursorEnd(): void {
    if (!this.view) return;
    const len = this.view.state.doc.length;
    this.view.dispatch({
      selection: { anchor: len },
      scrollIntoView: true,
    });
    this._dictationAnchor = len;
  }

  focus(): void {
    this.view?.focus();
  }

  focusAtEnd(): void {
    if (!this.view) return;
    const len = this.view.state.doc.length;
    this.view.dispatch({
      selection: { anchor: len },
      scrollIntoView: true,
    });
    this._dictationAnchor = len;
    this.view.focus();
  }

  scrollToBottom(): void {
    if (!this.view) return;
    this.view.dispatch({ scrollIntoView: true });
  }

  resetAnchorToEnd(): void {
    if (!this.view) return;
    this._dictationAnchor = this.view.state.doc.length;
  }

  snapAnchorToEnd(): void {
    if (!this.view) return;
    const len = this.view.state.doc.length;
    this._dictationAnchor = len;
    this.view.dispatch({
      selection: { anchor: len },
    });
  }

  getDocLength(): number {
    return this.view?.state.doc.length ?? 0;
  }

  hasInterim(): boolean {
    if (!this.view) return false;
    return this.view.state.field(interimField) !== null;
  }

  /** Get the full document text (includes interim). */
  getText(): string {
    return this.view?.state.doc.toString() ?? "";
  }

  // --- Internal ---

  private buildTheme(font: string): Extension {
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
        backgroundColor:
          "color-mix(in srgb, var(--accent) 20%, transparent) !important",
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

  private buildExtensions(font: string, disabled: boolean): Extension[] {
    return [
      this.themeCompartment.of(this.buildTheme(font)),
      ...interimExtensions(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      this.editableCompartment.of(EditorView.editable.of(!disabled)),
      EditorView.updateListener.of((update) => {
        if (this.updatingFromExternal) return;
        if (update.docChanged) {
          this.updatingFromCM = true;
          this.callbacks.onDocChange?.(update.state.doc.toString());
          this.updatingFromCM = false;
        }
        if (update.selectionSet && !update.docChanged) {
          const st = update.state;
          const range = st.field(interimField);
          if (range) {
            this.autoCommitOnCursorMove(st);
          } else {
            this._dictationAnchor = st.selection.main.head;
          }
        }
      }),
    ];
  }

  private autoCommitOnCursorMove(state: EditorState): void {
    const range = state.field(interimField);
    if (!range) return;
    const cursor = state.selection.main.head;
    if (cursor >= range.from && cursor <= range.to) return;
    this.commitInterim();
    this.callbacks.onInterimCommit?.();
    this._dictationAnchor = cursor;
  }
}
