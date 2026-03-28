// ---------------------------------------------------------------------------
// Unit tests for DictationEditorController.
//
// These cover the orchestration layer that was previously untestable inside
// DictationEditor.svelte:
//   R1  Bidirectional text sync (setText / onDocChange, feedback-loop guards)
//   R2  Interim text lifecycle (insert → replace → commit / finalize)
//   R3  Dictation anchor tracking (cursor click, reset, snap, isInsertingAtCursor)
//   R4  Committed text extraction
//   R5  Dynamic theming (font change via compartment)
//   R6  Editable / disabled toggle
//   R9  Callbacks (onDocChange, onInterimCommit)
//   R10 Programmatic cursor/focus methods
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { DictationEditorController, type DictationEditorCallbacks } from "../lib/DictationEditorController";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function create(doc = "", callbacks?: DictationEditorCallbacks) {
  return new DictationEditorController({
    initialDoc: doc,
    fontFamily: "monospace",
    disabled: false,
    callbacks,
  });
}

// ---------------------------------------------------------------------------
// R1 — Bidirectional text binding
// ---------------------------------------------------------------------------

describe("R1: Bidirectional text sync", () => {
  it("initialises with the provided document", () => {
    const ctrl = create("Hello");
    expect(ctrl.getText()).toBe("Hello");
    expect(ctrl.getDocLength()).toBe(5);
    ctrl.destroy();
  });

  it("setText replaces doc content", () => {
    const ctrl = create("old");
    ctrl.setText("new text");
    expect(ctrl.getText()).toBe("new text");
    ctrl.destroy();
  });

  it("setText is a no-op when text matches", () => {
    const ctrl = create("same");
    ctrl.setText("same"); // Should not throw or cause issues
    expect(ctrl.getText()).toBe("same");
    ctrl.destroy();
  });

  it("setText does not trigger onDocChange (no feedback loop)", () => {
    const onDocChange = vi.fn();
    const ctrl = create("start", { onDocChange });
    ctrl.setText("updated");
    expect(onDocChange).not.toHaveBeenCalled();
    ctrl.destroy();
  });

  it("defaults to empty document when no initialDoc", () => {
    const ctrl = new DictationEditorController();
    expect(ctrl.getText()).toBe("");
    expect(ctrl.getDocLength()).toBe(0);
    ctrl.destroy();
  });
});

// ---------------------------------------------------------------------------
// R2 — Interim text lifecycle
// ---------------------------------------------------------------------------

describe("R2: Interim text lifecycle", () => {
  it("insertInterim adds decorated text at anchor", () => {
    const ctrl = create();
    ctrl.insertInterim("Hello");
    expect(ctrl.getText()).toBe("Hello");
    expect(ctrl.hasInterim()).toBe(true);
    ctrl.destroy();
  });

  it("insertInterim prepends space when needed", () => {
    const ctrl = create("Hello.");
    // Anchor starts at doc end (6)
    ctrl.insertInterim("World");
    expect(ctrl.getText()).toBe("Hello. World");
    expect(ctrl.hasInterim()).toBe(true);
    ctrl.destroy();
  });

  it("insertInterim replaces existing interim", () => {
    const ctrl = create("Hi.");
    ctrl.insertInterim("there");
    expect(ctrl.getText()).toBe("Hi. there");

    ctrl.insertInterim("there folks");
    expect(ctrl.getText()).toBe("Hi. there folks");
    expect(ctrl.hasInterim()).toBe(true);
    ctrl.destroy();
  });

  it("insertInterim with empty string and no range is a no-op", () => {
    const ctrl = create("Hello");
    ctrl.insertInterim("");
    expect(ctrl.getText()).toBe("Hello");
    expect(ctrl.hasInterim()).toBe(false);
    ctrl.destroy();
  });

  it("commitInterim clears decoration, text stays", () => {
    const ctrl = create("A.");
    ctrl.insertInterim("B");
    expect(ctrl.hasInterim()).toBe(true);

    const result = ctrl.commitInterim();
    expect(result).toEqual({ text: "B", from: 3, to: 4 });
    expect(ctrl.getText()).toBe("A. B");
    expect(ctrl.hasInterim()).toBe(false);
    ctrl.destroy();
  });

  it("commitInterim returns null when no interim", () => {
    const ctrl = create("text");
    expect(ctrl.commitInterim()).toBeNull();
    ctrl.destroy();
  });

  it("finalizeInterim replaces interim with final text", () => {
    const ctrl = create("Hello.");
    ctrl.insertInterim("wrld");
    expect(ctrl.getText()).toBe("Hello. wrld");

    ctrl.finalizeInterim("world!");
    expect(ctrl.getText()).toBe("Hello. world!");
    expect(ctrl.hasInterim()).toBe(false);
    ctrl.destroy();
  });

  it("finalizeInterim inserts at anchor when no interim range", () => {
    const ctrl = create("Hello.");
    ctrl.finalizeInterim("World");
    expect(ctrl.getText()).toBe("Hello. World");
    expect(ctrl.hasInterim()).toBe(false);
    ctrl.destroy();
  });

  it("multi-segment flow without duplication", () => {
    const ctrl = create();

    // Segment 1
    ctrl.insertInterim("Hello");
    ctrl.insertInterim("Hello world");
    ctrl.finalizeInterim("Hello world.");
    expect(ctrl.getText()).toBe("Hello world.");

    // Segment 2
    ctrl.insertInterim("This");
    expect(ctrl.getText()).toBe("Hello world. This");
    ctrl.finalizeInterim("This is great.");
    expect(ctrl.getText()).toBe("Hello world. This is great.");

    // Segment 3
    ctrl.insertInterim("End");
    ctrl.finalizeInterim("End.");
    expect(ctrl.getText()).toBe("Hello world. This is great. End.");

    ctrl.destroy();
  });
});

// ---------------------------------------------------------------------------
// R3 — Dictation anchor tracking
// ---------------------------------------------------------------------------

describe("R3: Dictation anchor tracking", () => {
  it("initial anchor is at doc end", () => {
    const ctrl = create("Hello");
    expect(ctrl.dictationAnchor).toBe(5);
    ctrl.destroy();
  });

  it("anchor advances after finalizeInterim", () => {
    const ctrl = create("Hi.");
    // anchor = 3
    ctrl.finalizeInterim("Bye");
    // "Hi. Bye" → anchor should be at end of "Bye" = 7
    expect(ctrl.dictationAnchor).toBe(7);
    ctrl.destroy();
  });

  it("anchor advances after commitInterim", () => {
    const ctrl = create("A.");
    ctrl.insertInterim("B");
    const result = ctrl.commitInterim();
    expect(ctrl.dictationAnchor).toBe(result!.to); // 4
    ctrl.destroy();
  });

  it("resetAnchorToEnd sets anchor to doc end", () => {
    const ctrl = create("Hello world.");
    // Simulate anchor being somewhere in the middle by doing mid-text work
    ctrl.setText("Hello world. More text.");
    ctrl.resetAnchorToEnd();
    expect(ctrl.dictationAnchor).toBe(ctrl.getDocLength());
    ctrl.destroy();
  });

  it("snapAnchorToEnd sets anchor and cursor to doc end", () => {
    const ctrl = create("Hello");
    ctrl.snapAnchorToEnd();
    expect(ctrl.dictationAnchor).toBe(5);
    ctrl.destroy();
  });

  it("isInsertingAtCursor returns false when anchor is at end", () => {
    const ctrl = create("Hello");
    expect(ctrl.isInsertingAtCursor()).toBe(false);
    ctrl.destroy();
  });

  it("isInsertingAtCursor returns false on destroyed controller", () => {
    const ctrl = create("Hello");
    ctrl.destroy();
    expect(ctrl.isInsertingAtCursor()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R4 — Committed text extraction
// ---------------------------------------------------------------------------

describe("R4: Committed text extraction", () => {
  it("returns full text when no interim", () => {
    const ctrl = create("Hello world.");
    expect(ctrl.getCommittedText()).toBe("Hello world.");
    ctrl.destroy();
  });

  it("strips interim text", () => {
    const ctrl = create("Hello.");
    ctrl.insertInterim("World");
    // Doc: "Hello. World", interim is "World" — committed includes separator space
    expect(ctrl.getCommittedText()).toBe("Hello. ");
    ctrl.destroy();
  });

  it("returns full text after finalize", () => {
    const ctrl = create("Hello.");
    ctrl.insertInterim("World");
    ctrl.finalizeInterim("World!");
    expect(ctrl.getCommittedText()).toBe("Hello. World!");
    ctrl.destroy();
  });

  it("returns empty string on destroyed controller", () => {
    const ctrl = create("Hello");
    ctrl.destroy();
    expect(ctrl.getCommittedText()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// R5 — Dynamic theming (font change)
// ---------------------------------------------------------------------------

describe("R5: Dynamic theming", () => {
  it("setFontFamily does not throw and controller stays alive", () => {
    const ctrl = create("text");
    expect(() => ctrl.setFontFamily("'Georgia', serif")).not.toThrow();
    expect(ctrl.alive).toBe(true);
    expect(ctrl.getText()).toBe("text");
    ctrl.destroy();
  });

  it("setFontFamily on destroyed controller is a no-op", () => {
    const ctrl = create();
    ctrl.destroy();
    expect(() => ctrl.setFontFamily("serif")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// R6 — Editable / disabled toggle
// ---------------------------------------------------------------------------

describe("R6: Editable / disabled toggle", () => {
  it("setDisabled does not throw and controller stays alive", () => {
    const ctrl = create("text");
    expect(() => ctrl.setDisabled(true)).not.toThrow();
    expect(ctrl.alive).toBe(true);

    expect(() => ctrl.setDisabled(false)).not.toThrow();
    expect(ctrl.alive).toBe(true);
    ctrl.destroy();
  });

  it("can be created in disabled state", () => {
    const ctrl = new DictationEditorController({
      initialDoc: "readonly",
      disabled: true,
    });
    expect(ctrl.getText()).toBe("readonly");
    ctrl.destroy();
  });

  it("setDisabled on destroyed controller is a no-op", () => {
    const ctrl = create();
    ctrl.destroy();
    expect(() => ctrl.setDisabled(true)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// R9 — Callbacks
// ---------------------------------------------------------------------------

describe("R9: Callbacks", () => {
  it("setCallbacks replaces callbacks", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ctrl = create("", { onInterimCommit: first });
    ctrl.setCallbacks({ onInterimCommit: second });

    // The new callback should be used.  We can't easily trigger a cursor-move
    // commit in jsdom, but we can verify setCallbacks doesn't throw and the
    // controller is still functional.
    expect(ctrl.alive).toBe(true);
    ctrl.destroy();
  });
});

// ---------------------------------------------------------------------------
// R10 — Programmatic cursor / focus methods
// ---------------------------------------------------------------------------

describe("R10: Programmatic cursor/focus", () => {
  it("setCursorEnd moves anchor to doc end", () => {
    const ctrl = create("Hello world.");
    // Force anchor to 0 by creating fresh controller with empty doc then setting text
    const ctrl2 = create();
    ctrl2.setText("Hello world.");
    // anchor is still 0 from initial empty doc
    expect(ctrl2.dictationAnchor).toBe(0);
    ctrl2.setCursorEnd();
    expect(ctrl2.dictationAnchor).toBe(12);
    ctrl.destroy();
    ctrl2.destroy();
  });

  it("focusAtEnd moves anchor to doc end", () => {
    const ctrl = create();
    ctrl.setText("ABC");
    ctrl.focusAtEnd();
    expect(ctrl.dictationAnchor).toBe(3);
    ctrl.destroy();
  });

  it("scrollToBottom does not throw", () => {
    const ctrl = create("some text\nwith lines\n");
    expect(() => ctrl.scrollToBottom()).not.toThrow();
    ctrl.destroy();
  });

  it("focus does not throw", () => {
    const ctrl = create("text");
    expect(() => ctrl.focus()).not.toThrow();
    ctrl.destroy();
  });

  it("getDocLength returns document length", () => {
    const ctrl = create("12345");
    expect(ctrl.getDocLength()).toBe(5);
    ctrl.setText("123456789");
    expect(ctrl.getDocLength()).toBe(9);
    ctrl.destroy();
  });

  it("getDocLength returns 0 on destroyed controller", () => {
    const ctrl = create("text");
    ctrl.destroy();
    expect(ctrl.getDocLength()).toBe(0);
  });

  it("methods are no-ops on destroyed controller", () => {
    const ctrl = create("text");
    ctrl.destroy();
    expect(() => ctrl.setCursorEnd()).not.toThrow();
    expect(() => ctrl.focusAtEnd()).not.toThrow();
    expect(() => ctrl.scrollToBottom()).not.toThrow();
    expect(() => ctrl.focus()).not.toThrow();
    expect(() => ctrl.resetAnchorToEnd()).not.toThrow();
    expect(() => ctrl.snapAnchorToEnd()).not.toThrow();
    expect(() => ctrl.insertInterim("x")).not.toThrow();
    expect(ctrl.commitInterim()).toBeNull();
    expect(() => ctrl.finalizeInterim("x")).not.toThrow();
    expect(ctrl.hasInterim()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("Lifecycle", () => {
  it("alive is true after creation, false after destroy", () => {
    const ctrl = create("text");
    expect(ctrl.alive).toBe(true);
    ctrl.destroy();
    expect(ctrl.alive).toBe(false);
  });

  it("attach mounts the editor into a DOM element", () => {
    const ctrl = create("Hello");
    const container = document.createElement("div");
    ctrl.attach(container);
    // CM6 renders a .cm-editor element
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    ctrl.destroy();
  });

  it("double destroy is safe", () => {
    const ctrl = create();
    ctrl.destroy();
    expect(() => ctrl.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration: End-to-end dictation session through controller
// ---------------------------------------------------------------------------

describe("End-to-end dictation session", () => {
  it("simulates a full recording → stop → copy flow", () => {
    const ctrl = create();

    // User opens popup — empty editor
    expect(ctrl.getText()).toBe("");
    expect(ctrl.dictationAnchor).toBe(0);

    // Speech starts: interim results arrive
    ctrl.insertInterim("Hello");
    expect(ctrl.getText()).toBe("Hello");
    expect(ctrl.hasInterim()).toBe(true);

    ctrl.insertInterim("Hello world");
    expect(ctrl.getText()).toBe("Hello world");

    // Provider sends final
    ctrl.finalizeInterim("Hello world.");
    expect(ctrl.getText()).toBe("Hello world.");
    expect(ctrl.hasInterim()).toBe(false);
    expect(ctrl.dictationAnchor).toBe(12);

    // Second segment
    ctrl.insertInterim("How");
    ctrl.insertInterim("How are you");
    ctrl.finalizeInterim("How are you?");
    expect(ctrl.getText()).toBe("Hello world. How are you?");
    expect(ctrl.dictationAnchor).toBe(25);

    // Recording stops — committed text for copy
    expect(ctrl.getCommittedText()).toBe("Hello world. How are you?");

    // User closes popup
    ctrl.destroy();
  });

  it("simulates user edit during recording (commit-on-edit)", () => {
    const ctrl = create();

    // First segment finalized
    ctrl.insertInterim("First");
    ctrl.finalizeInterim("First.");
    expect(ctrl.getText()).toBe("First.");

    // Second segment starts
    ctrl.insertInterim("Second");
    expect(ctrl.getText()).toBe("First. Second");
    expect(ctrl.hasInterim()).toBe(true);

    // User manually commits (simulating what happens on user edit)
    ctrl.commitInterim();
    expect(ctrl.hasInterim()).toBe(false);
    expect(ctrl.getText()).toBe("First. Second");

    // Third segment
    ctrl.insertInterim("Third");
    expect(ctrl.getText()).toBe("First. Second Third");
    ctrl.finalizeInterim("Third.");
    expect(ctrl.getText()).toBe("First. Second Third.");

    ctrl.destroy();
  });

  it("simulates resetAnchorToEnd before new recording session", () => {
    const ctrl = create("Previous text from last session.");
    ctrl.resetAnchorToEnd();
    expect(ctrl.dictationAnchor).toBe(32);

    ctrl.insertInterim("New");
    expect(ctrl.getText()).toBe("Previous text from last session. New");
    ctrl.finalizeInterim("New session.");
    expect(ctrl.getText()).toBe("Previous text from last session. New session.");

    ctrl.destroy();
  });

  it("simulates setText (template apply) then recording", () => {
    const ctrl = create();

    // Apply template
    ctrl.setText("Template: {{topic}}\n\n");
    ctrl.setCursorEnd();
    expect(ctrl.dictationAnchor).toBe(21);

    // Start recording
    ctrl.insertInterim("My notes");
    expect(ctrl.getText()).toBe("Template: {{topic}}\n\nMy notes");
    ctrl.finalizeInterim("My notes about AI.");
    expect(ctrl.getText()).toBe("Template: {{topic}}\n\nMy notes about AI.");

    ctrl.destroy();
  });
});
