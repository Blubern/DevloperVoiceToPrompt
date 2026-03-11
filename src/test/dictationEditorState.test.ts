import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  interimField,
  interimExtensions,
  insertInterim,
  commitInterim,
  finalizeInterim,
  getCommittedText,
  isInsertingAtCursor,
} from "../lib/dictationEditorState";

/** Create a minimal EditorView for testing. */
function createView(doc = ""): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: interimExtensions(),
    }),
  });
}

function docText(view: EditorView): string {
  return view.state.doc.toString();
}

function interimRange(view: EditorView) {
  return view.state.field(interimField);
}

describe("dictationEditorState", () => {
  // ----- insertInterim -----

  describe("insertInterim", () => {
    it("inserts text at anchor on empty doc", () => {
      const view = createView();
      insertInterim({ view, anchor: 0 }, "Hello");
      expect(docText(view)).toBe("Hello");
      expect(interimRange(view)).toEqual({ from: 0, to: 5 });
    });

    it("prepends space when char before anchor is not whitespace", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello. World");
      // Space is OUTSIDE the interim range (committed separator)
      expect(interimRange(view)).toEqual({ from: 7, to: 12 });
    });

    it("does not prepend space when char before anchor is space", () => {
      const view = createView("Hello ");
      insertInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello World");
      expect(interimRange(view)).toEqual({ from: 6, to: 11 });
    });

    it("does not prepend space when char before anchor is newline", () => {
      const view = createView("Hello\n");
      insertInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello\nWorld");
      expect(interimRange(view)).toEqual({ from: 6, to: 11 });
    });

    it("replaces existing interim range without losing separator space", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "Hi");
      expect(docText(view)).toBe("Hello. Hi");
      expect(interimRange(view)).toEqual({ from: 7, to: 9 });

      // Now replace interim with longer text — space must survive
      insertInterim({ view, anchor: 6 }, "Hi there");
      expect(docText(view)).toBe("Hello. Hi there");
      expect(interimRange(view)).toEqual({ from: 7, to: 15 });
    });

    it("replaces existing interim with shorter text", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "World people");
      expect(docText(view)).toBe("Hello. World people");
      expect(interimRange(view)).toEqual({ from: 7, to: 19 });

      insertInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello. World");
      expect(interimRange(view)).toEqual({ from: 7, to: 12 });
    });

    it("is a no-op when newInterim is empty and no existing range", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "");
      expect(docText(view)).toBe("Hello.");
      expect(interimRange(view)).toBeNull();
    });

    it("inserts at mid-text anchor", () => {
      const view = createView("Hello world.");
      insertInterim({ view, anchor: 5 }, "beautiful");
      expect(docText(view)).toBe("Hello beautiful world.");
      expect(interimRange(view)).toEqual({ from: 6, to: 15 });
    });

    it("inserts at start of doc (anchor=0)", () => {
      const view = createView("existing text");
      insertInterim({ view, anchor: 0 }, "New");
      expect(docText(view)).toBe("Newexisting text");
      expect(interimRange(view)).toEqual({ from: 0, to: 3 });
    });
  });

  // ----- commitInterim -----

  describe("commitInterim", () => {
    it("returns null when no interim exists", () => {
      const view = createView("Hello");
      expect(commitInterim(view)).toBeNull();
    });

    it("clears interim decoration, leaves text in doc", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "World");
      expect(interimRange(view)).not.toBeNull();

      const result = commitInterim(view);
      expect(result).toEqual({ text: "World", from: 7, to: 12, newAnchor: 12 });
      expect(docText(view)).toBe("Hello. World");
      expect(interimRange(view)).toBeNull();
    });

    it("committed text includes only interim range (not separator space)", () => {
      const view = createView("A");
      insertInterim({ view, anchor: 1 }, "B");
      const result = commitInterim(view);
      expect(result!.text).toBe("B");
      expect(docText(view)).toBe("A B");
    });
  });

  // ----- finalizeInterim -----

  describe("finalizeInterim", () => {
    it("replaces interim range with final text", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "Wrld");
      expect(docText(view)).toBe("Hello. Wrld");

      const anchor = finalizeInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello. World");
      expect(interimRange(view)).toBeNull();
      expect(anchor).toBe(12);
    });

    it("preserves separator space when finalizing", () => {
      const view = createView("First.");
      insertInterim({ view, anchor: 6 }, "Second");
      expect(docText(view)).toBe("First. Second");

      finalizeInterim({ view, anchor: 6 }, "Second!");
      expect(docText(view)).toBe("First. Second!");
    });

    it("inserts at anchor with space when no interim range exists", () => {
      const view = createView("Hello.");
      const anchor = finalizeInterim({ view, anchor: 6 }, "World");
      expect(docText(view)).toBe("Hello. World");
      expect(anchor).toBe(12);
    });

    it("inserts at anchor without space when preceded by whitespace", () => {
      const view = createView("Hello. ");
      const anchor = finalizeInterim({ view, anchor: 7 }, "World");
      expect(docText(view)).toBe("Hello. World");
      expect(anchor).toBe(12);
    });

    it("handles finalization with different text than interim (punctuation fix)", () => {
      const view = createView("Hello");
      insertInterim({ view, anchor: 5 }, "world");
      finalizeInterim({ view, anchor: 5 }, "world.");
      expect(docText(view)).toBe("Hello world.");
    });
  });

  // ----- Multi-segment flow (simulates full dictation session) -----

  describe("multi-segment dictation flow", () => {
    it("handles multiple interim→finalize cycles without duplication", () => {
      const view = createView();
      let anchor = 0;

      // Segment 1: interim evolves, then finalizes
      anchor = insertInterim({ view, anchor }, "Hello");
      expect(docText(view)).toBe("Hello");

      anchor = insertInterim({ view, anchor }, "Hello world");
      expect(docText(view)).toBe("Hello world");

      anchor = finalizeInterim({ view, anchor }, "Hello world.");
      expect(docText(view)).toBe("Hello world.");
      expect(anchor).toBe(12);

      // Segment 2: new interim starts, gets separator space
      insertInterim({ view, anchor }, "This");
      expect(docText(view)).toBe("Hello world. This");

      insertInterim({ view, anchor }, "This is a test");
      expect(docText(view)).toBe("Hello world. This is a test");

      anchor = finalizeInterim({ view, anchor }, "This is a test.");
      expect(docText(view)).toBe("Hello world. This is a test.");
      expect(anchor).toBe(28);

      // Segment 3
      insertInterim({ view, anchor }, "Final");
      expect(docText(view)).toBe("Hello world. This is a test. Final");

      anchor = finalizeInterim({ view, anchor }, "Final sentence.");
      expect(docText(view)).toBe("Hello world. This is a test. Final sentence.");
    });

    it("empty interim after final is a no-op", () => {
      const view = createView();
      let anchor = 0;

      insertInterim({ view, anchor }, "Hello");
      anchor = finalizeInterim({ view, anchor }, "Hello.");
      expect(docText(view)).toBe("Hello.");

      // Whisper sends onInterim("") after onFinal — should be no-op
      insertInterim({ view, anchor }, "");
      expect(docText(view)).toBe("Hello.");
      expect(interimRange(view)).toBeNull();
    });

    it("handles mid-text insertion across segments", () => {
      const view = createView("Start. End.");
      let anchor = 6; // after "Start."

      insertInterim({ view, anchor }, "Middle");
      expect(docText(view)).toBe("Start. Middle End.");

      anchor = finalizeInterim({ view, anchor }, "Middle.");
      expect(docText(view)).toBe("Start. Middle. End.");
      expect(anchor).toBe(14);
    });
  });

  // ----- getCommittedText -----

  describe("getCommittedText", () => {
    it("returns full text when no interim", () => {
      const view = createView("Hello world.");
      expect(getCommittedText(view)).toBe("Hello world.");
    });

    it("strips interim text (keeps separator space)", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "World");
      // separator space is committed text (outside interim range)
      expect(getCommittedText(view)).toBe("Hello. ");
    });

    it("strips interim from mid-text", () => {
      const view = createView("Start. End.");
      insertInterim({ view, anchor: 6 }, "Mid");
      // Doc: "Start. Mid End." — interim is "Mid" at {7,10}
      // Committed: "Start.  End." (space before + after)
      expect(getCommittedText(view)).toBe("Start.  End.");
    });
  });

  // ----- isInsertingAtCursor -----

  describe("isInsertingAtCursor", () => {
    it("returns false when anchor is at end", () => {
      const view = createView("Hello");
      expect(isInsertingAtCursor(view, 5)).toBe(false);
    });

    it("returns true when anchor is before committed text end", () => {
      const view = createView("Hello world.");
      expect(isInsertingAtCursor(view, 5)).toBe(true);
    });

    it("returns false when anchor is at end with trailing whitespace", () => {
      const view = createView("Hello   ");
      // Anchor at 5, committed end at 8, but only spaces after anchor
      expect(isInsertingAtCursor(view, 5)).toBe(false);
    });

    it("returns false when anchor is inside trailing whitespace", () => {
      const view = createView("Hello   ");
      // Anchor at 6 (middle of trailing spaces)
      expect(isInsertingAtCursor(view, 6)).toBe(false);
    });

    it("returns false when trailing space exists after interim", () => {
      // Simulate: user typed a space, then speech added interim text
      const view = createView("Hello ");
      insertInterim({ view, anchor: 5 }, "something");
      // Doc: "Hello something " — interim range with trailing space after it
      expect(isInsertingAtCursor(view, 5)).toBe(false);
    });

    it("returns false when only interim text is after anchor", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "World");
      // Doc: "Hello. World" — interim at {7,12} is at the tail
      // Committed end = range.from = 7, but anchor at 6 includes the separator
      // Actually anchor 6 < 7 is true... but the space at pos 6 is committed.
      // Range starts at 7, so committedEnd = 7, anchor 6 < 7 → true?
      // That's correct: the space before interim is committed text after anchor.
      // Let's test with anchor at the space:
      expect(isInsertingAtCursor(view, 7)).toBe(false);
    });

    it("returns true when there is committed text after interim", () => {
      const view = createView("Start. End.");
      insertInterim({ view, anchor: 6 }, "Mid");
      // Doc: "Start. Mid End." — interim at tail? No, "End." is after.
      // range.to = 10, docLen = 15, range.to !== docLen → committedEnd = 15
      expect(isInsertingAtCursor(view, 6)).toBe(true);
    });
  });

  // ----- commitInterim then new segment -----

  describe("commit then new segment", () => {
    it("preserves space after commit + new insertInterim", () => {
      const view = createView("Hello.");
      insertInterim({ view, anchor: 6 }, "A");
      const result = commitInterim(view);
      expect(docText(view)).toBe("Hello. A");
      expect(result!.newAnchor).toBe(8);

      // New segment starts after committed text
      insertInterim({ view, anchor: result!.newAnchor }, "B");
      expect(docText(view)).toBe("Hello. A B");
      expect(interimRange(view)).toEqual({ from: 9, to: 10 });
    });
  });
});
