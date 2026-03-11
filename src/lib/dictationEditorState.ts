// ---------------------------------------------------------------------------
// Pure CM6 state logic for the dictation editor, extracted for testability.
// DictationEditor.svelte delegates to these primitives.
// ---------------------------------------------------------------------------

import { EditorState, StateField, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";

// --- Interim range tracking ---

/** Effect to set (or clear) the interim range. */
export const setInterimRange = StateEffect.define<{ from: number; to: number } | null>();

/** StateField tracking the current interim text range (or null). */
export const interimField = StateField.define<{ from: number; to: number } | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setInterimRange)) {
        return e.value;
      }
    }
    if (value && tr.docChanged) {
      const newFrom = tr.changes.mapPos(value.from);
      const newTo = tr.changes.mapPos(value.to);
      if (newFrom >= newTo) return null;
      return { from: newFrom, to: newTo };
    }
    return value;
  },
});

/** Decoration that highlights the interim range with .interim-text class. */
export const interimDecoration = EditorView.decorations.compute([interimField], (state) => {
  const range = state.field(interimField);
  if (!range || range.from >= range.to) return Decoration.none;
  return Decoration.set([
    Decoration.mark({ class: "interim-text" }).range(range.from, range.to),
  ]);
});

/** Minimal extension set needed for interim tracking in tests. */
export function interimExtensions(): Extension[] {
  return [interimField, interimDecoration];
}

// --- Operations (pure functions operating on EditorView + anchor) ---

export interface InterimOp {
  view: EditorView;
  anchor: number;
}

/**
 * Insert or replace interim text at the dictation anchor.
 * Returns updated anchor position.
 */
export function insertInterim(op: InterimOp, newInterim: string): number {
  const { view } = op;
  let { anchor } = op;
  const state = view.state;
  const range = state.field(interimField);

  // Guard: empty interim with no existing range is a no-op
  if (!newInterim && !range) return anchor;

  if (range) {
    // Replace existing interim range content only.
    // Separator space lives BEFORE the range as committed text — untouched.
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: newInterim },
      effects: setInterimRange.of({
        from: range.from,
        to: range.from + newInterim.length,
      }),
    });
  } else {
    // New interim at dictation anchor — insert separator space as committed
    // text BEFORE the interim range so it can't be lost on replacement.
    const from = Math.min(anchor, state.doc.length);
    let spacer = "";
    if (from > 0) {
      const charBefore = state.doc.sliceString(from - 1, from);
      if (charBefore !== " " && charBefore !== "\n") {
        spacer = " ";
      }
    }
    const rangeFrom = from + spacer.length;
    view.dispatch({
      changes: { from, to: from, insert: spacer + newInterim },
      effects: setInterimRange.of({
        from: rangeFrom,
        to: rangeFrom + newInterim.length,
      }),
    });
  }
  return anchor;
}

/**
 * Commit interim text: remove decoration, text stays in document.
 * Returns { text, from, to, newAnchor } or null if no interim.
 */
export function commitInterim(view: EditorView): { text: string; from: number; to: number; newAnchor: number } | null {
  const range = view.state.field(interimField);
  if (!range) return null;

  const committedText = view.state.doc.sliceString(range.from, range.to);
  view.dispatch({ effects: setInterimRange.of(null) });

  return { text: committedText, from: range.from, to: range.to, newAnchor: range.to };
}

/**
 * Finalize interim: replace range content with final text, clear decoration.
 * If no interim, inserts at anchor with space-prepend logic.
 * Returns updated anchor position.
 */
export function finalizeInterim(op: InterimOp, finalText: string): number {
  const { view } = op;
  let { anchor } = op;
  const state = view.state;
  const range = state.field(interimField);

  if (range) {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: finalText },
      effects: setInterimRange.of(null),
      selection: { anchor: range.from + finalText.length },
    });
    return range.from + finalText.length;
  } else {
    const from = Math.min(anchor, state.doc.length);
    let insertText = finalText;
    if (from > 0) {
      const charBefore = state.doc.sliceString(from - 1, from);
      if (charBefore !== " " && charBefore !== "\n") {
        insertText = " " + insertText;
      }
    }
    view.dispatch({
      changes: { from, to: from, insert: insertText },
      effects: setInterimRange.of(null),
      selection: { anchor: from + insertText.length },
    });
    return from + insertText.length;
  }
}

/**
 * Get committed text only (interim stripped).
 */
export function getCommittedText(view: EditorView): string {
  const range = view.state.field(interimField);
  const doc = view.state.doc.toString();
  if (!range) return doc;
  return doc.slice(0, range.from) + doc.slice(range.to);
}

/**
 * Check if anchor is before committed text end (inserting mid-text).
 * Trailing whitespace after the anchor is ignored — if the only text
 * between the anchor and the committed end is whitespace, the user is
 * effectively "at the end".
 */
export function isInsertingAtCursor(view: EditorView, anchor: number): boolean {
  const range = view.state.field(interimField);
  const docLen = view.state.doc.length;
  let committedEnd = docLen;
  if (range && range.to === docLen) {
    committedEnd = range.from;
  }
  if (anchor >= committedEnd) return false;
  // If only whitespace remains between anchor and committedEnd, treat as "at end"
  const textAfter = view.state.doc.sliceString(anchor, committedEnd);
  return textAfter.trim().length > 0;
}
