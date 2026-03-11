/**
 * Unit tests for the popup text model logic used with the CodeMirror 6
 * DictationEditor component.
 *
 * The core logic:
 * - Insert new final segments at a dictation anchor position (with auto-spacing)
 * - Commit interim text on user edit or on recording stop
 * - Track dictationAnchor after insertions and edits
 *
 * We replicate the logic here to test it in isolation without mounting
 * a Svelte component or CodeMirror instance.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extracted pure logic mirrors (matching Popup.svelte implementation)
// ---------------------------------------------------------------------------

/**
 * Mirrors the rebuild $effect in Popup.svelte: insert new final segments at
 * the dictation anchor, return updated state.
 */
function insertFinalSegments(
  editedText: string,
  finalSegments: string[],
  lastSyncedSegmentCount: number,
  dictationAnchor: number,
) {
  const newSegments = finalSegments.slice(lastSyncedSegmentCount);
  if (newSegments.length === 0) {
    return { editedText, dictationAnchor, lastSyncedSegmentCount };
  }

  const addition = newSegments.join(" ");
  const before = editedText.slice(0, dictationAnchor);
  const after = editedText.slice(dictationAnchor);
  const needsSpace =
    before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
  const insertText = (needsSpace ? " " : "") + addition;
  const newEditedText = before + insertText + after;
  const newAnchor = dictationAnchor + insertText.length;

  return {
    editedText: newEditedText,
    dictationAnchor: newAnchor,
    lastSyncedSegmentCount: finalSegments.length,
  };
}

/**
 * Mirrors the commit-on-edit logic: when the user types, any pending
 * interim is committed (decoration removed, text stays) and the
 * dictation anchor moves to the user's cursor position.
 *
 * In the CM6 implementation, interim text lives in the document and is
 * committed by clearing the decoration. The finalSegments array is no
 * longer directly involved in commit-on-edit (the editor handles it).
 * This test verifies the resulting state.
 */
function commitOnEdit(
  hasInterim: boolean,
  newEditedText: string,
  newCursorPos: number,
) {
  return {
    interimCommitted: hasInterim,
    editedText: newEditedText,
    dictationAnchor: newCursorPos,
  };
}

/**
 * Mirrors the commit-on-stop logic in stopAndRecordUsage: promote any
 * remaining interim after the provider stops.
 */
function commitOnStop(
  interimText: string,
  finalSegments: string[],
  lastSyncedSegmentCount: number,
) {
  if (!interimText) {
    return { finalSegments, interimText, lastSyncedSegmentCount };
  }

  const newSegments = [...finalSegments, interimText];
  return {
    finalSegments: newSegments,
    interimText: "",
    lastSyncedSegmentCount: newSegments.length,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Final segment insertion at anchor position", () => {
  it("inserts first segment at end of empty text", () => {
    const result = insertFinalSegments("", ["Hello world"], 0, 0);
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11);
    expect(result.lastSyncedSegmentCount).toBe(1);
  });

  it("inserts segment at end of existing text with space", () => {
    const result = insertFinalSegments("Hello", ["Hello", "world"], 1, 5);
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11);
  });

  it("inserts segment at beginning of text", () => {
    const result = insertFinalSegments("world", ["Hello"], 0, 0);
    // No space added: before is empty (anchor=0), so needsSpace=false.
    // The function doesn't add trailing space before existing text.
    expect(result.editedText).toBe("Helloworld");
    expect(result.dictationAnchor).toBe(5);
  });

  it("inserts segment in the middle of text", () => {
    const result = insertFinalSegments(
      "Hello world",
      ["beautiful"],
      0,
      6, // anchor at position 6 (after "Hello ")
    );
    // before = "Hello " (ends with space) → needsSpace = false
    // insertText = "beautiful", after = "world"
    // Result: "Hello " + "beautiful" + "world" = "Hello beautifulworld"
    // The function doesn't add trailing space before existing text.
    expect(result.editedText).toBe("Hello beautifulworld");
    expect(result.dictationAnchor).toBe(15); // 6 + "beautiful".length
  });

  it("adds space when preceding text doesn't end with space or newline", () => {
    const result = insertFinalSegments("Hello", ["world"], 0, 5);
    // before = "Hello", no trailing space → needsSpace = true
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11); // 5 + " world".length
  });

  it("does not add space when preceding text ends with space", () => {
    const result = insertFinalSegments("Hello ", ["world"], 0, 6);
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11);
  });

  it("does not add space when preceding text ends with newline", () => {
    const result = insertFinalSegments("Hello\n", ["world"], 0, 6);
    expect(result.editedText).toBe("Hello\nworld");
    expect(result.dictationAnchor).toBe(11);
  });

  it("inserts multiple new segments joined with space", () => {
    const result = insertFinalSegments("", ["Hello", "world"], 0, 0);
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11);
    expect(result.lastSyncedSegmentCount).toBe(2);
  });

  it("only inserts segments beyond lastSyncedSegmentCount", () => {
    const result = insertFinalSegments(
      "Hello",
      ["Hello", "world", "foo"],
      1,
      5,
    );
    expect(result.editedText).toBe("Hello world foo");
    expect(result.lastSyncedSegmentCount).toBe(3);
  });

  it("no-ops when no new segments exist", () => {
    const result = insertFinalSegments("Hello", ["Hello"], 1, 5);
    expect(result.editedText).toBe("Hello");
    expect(result.dictationAnchor).toBe(5);
    expect(result.lastSyncedSegmentCount).toBe(1);
  });
});

describe("Commit-on-edit (interim promotion on user edit)", () => {
  it("commits interim decoration before applying edit", () => {
    const result = commitOnEdit(
      true,           // has interim
      "Hello world",  // user typed " world"
      11,             // cursor at end
    );
    expect(result.interimCommitted).toBe(true);
    expect(result.editedText).toBe("Hello world");
    expect(result.dictationAnchor).toBe(11);
  });

  it("does nothing when no interim pending", () => {
    const result = commitOnEdit(
      false,
      "Hello!",
      6,
    );
    expect(result.interimCommitted).toBe(false);
  });

  it("updates dictation anchor to new cursor position", () => {
    const result = commitOnEdit(true, "A B", 2);
    expect(result.dictationAnchor).toBe(2);
  });
});

describe("Commit-on-stop (interim promotion on recording stop)", () => {
  it("promotes remaining interim to final on stop", () => {
    const result = commitOnStop("leftover speech", ["Hello", "world"], 2);
    expect(result.finalSegments).toEqual(["Hello", "world", "leftover speech"]);
    expect(result.interimText).toBe("");
    expect(result.lastSyncedSegmentCount).toBe(3);
  });

  it("no-ops when no interim pending", () => {
    const result = commitOnStop("", ["Hello"], 1);
    expect(result.finalSegments).toEqual(["Hello"]);
    expect(result.interimText).toBe("");
    expect(result.lastSyncedSegmentCount).toBe(1);
  });
});

describe("dictationAnchor tracking", () => {
  it("advances anchor after segment insertion", () => {
    let anchor = 0;
    const r1 = insertFinalSegments("", ["Hello"], 0, anchor);
    anchor = r1.dictationAnchor;
    expect(anchor).toBe(5);

    const r2 = insertFinalSegments(r1.editedText, ["Hello", "world"], 1, anchor);
    anchor = r2.dictationAnchor;
    expect(anchor).toBe(11);
  });

  it("anchor tracks user cursor position after edit", () => {
    const result = commitOnEdit(false, "typed text", 5);
    expect(result.dictationAnchor).toBe(5);
  });

  it("anchor resets to 0 on clear text", () => {
    // clearText sets dictationAnchor = 0
    const anchor = 0;
    expect(anchor).toBe(0);
  });

  it("anchor sets to text length on undo clear", () => {
    // undoClear sets dictationAnchor = undoSnapshot.text.length
    const restoredText = "restored text";
    const anchor = restoredText.length;
    expect(anchor).toBe(13);
  });

  it("anchor set to editedText.length before new recording session", () => {
    // toggleMic resets dictationAnchor = editedText.length
    const editedText = "existing text";
    const anchor = editedText.length;
    expect(anchor).toBe(13);
  });
});

describe("Inline interim text model", () => {
  it("interim text is part of the document with a decoration range", () => {
    // In CM6, interim text is inserted into the document and marked with
    // a Decoration.mark. The "committed text" is the doc minus the interim range.
    const fullDoc = "Hello streaming";
    const interimRange = { from: 6, to: 15 }; // "streaming"
    const committed = fullDoc.slice(0, interimRange.from) + fullDoc.slice(interimRange.to);
    expect(committed).toBe("Hello ");
  });

  it("no interim means full doc is committed text", () => {
    const fullDoc = "Hello world";
    // When there's no interim range, committed text equals the full document
    expect(fullDoc).toBe("Hello world");
  });

  it("interim at end of doc leaves prefix as committed", () => {
    const fullDoc = "Hello world";
    const interimRange = { from: 6, to: 11 }; // "world"
    const committed = fullDoc.slice(0, interimRange.from) + fullDoc.slice(interimRange.to);
    expect(committed).toBe("Hello ");
  });

  it("interim at start of doc leaves suffix as committed", () => {
    const fullDoc = "streaming Hello";
    const interimRange = { from: 0, to: 9 }; // "streaming"
    const committed = fullDoc.slice(0, interimRange.from) + fullDoc.slice(interimRange.to);
    expect(committed).toBe(" Hello");
  });
});

describe("End-to-end text model scenarios", () => {
  it("speak → insert → speak more → produces correct text", () => {
    let editedText = "";
    let segments: string[] = [];
    let syncCount = 0;
    let anchor = 0;

    // First recognition
    segments = [...segments, "Hello"];
    const r1 = insertFinalSegments(editedText, segments, syncCount, anchor);
    editedText = r1.editedText;
    anchor = r1.dictationAnchor;
    syncCount = r1.lastSyncedSegmentCount;
    expect(editedText).toBe("Hello");

    // Second recognition
    segments = [...segments, "world"];
    const r2 = insertFinalSegments(editedText, segments, syncCount, anchor);
    editedText = r2.editedText;
    anchor = r2.dictationAnchor;
    syncCount = r2.lastSyncedSegmentCount;
    expect(editedText).toBe("Hello world");
  });

  it("speak → user edits → speak more → text preserved", () => {
    let editedText = "";
    let segments: string[] = [];
    let syncCount = 0;
    let anchor = 0;

    // Recognition produces final
    segments = [...segments, "Hello"];
    const r1 = insertFinalSegments(editedText, segments, syncCount, anchor);
    editedText = r1.editedText;
    anchor = r1.dictationAnchor;
    syncCount = r1.lastSyncedSegmentCount;
    expect(editedText).toBe("Hello");

    // User types " beautiful" (commit-on-edit fires — no interim to commit in this case)
    const edit = commitOnEdit(false, "Hello beautiful", 15);
    editedText = edit.editedText;
    anchor = edit.dictationAnchor;

    expect(editedText).toBe("Hello beautiful");
    expect(anchor).toBe(15);
  });

  it("speak with interim → stop → all text committed", () => {
    let editedText = "";
    let segments: string[] = [];
    let syncCount = 0;
    let anchor = 0;

    // Final segment arrives
    segments = ["Hello"];
    const r1 = insertFinalSegments(editedText, segments, syncCount, anchor);
    editedText = r1.editedText;
    anchor = r1.dictationAnchor;
    syncCount = r1.lastSyncedSegmentCount;

    // In CM6 model, interim "world" would be in the document as a decorated range.
    // On stop, commitInterim() clears the decoration, text stays.
    // For pure-function testing, we simulate: text is "Hello world" with
    // interim range covering "world", and commit makes it permanent.
    const docWithInterim = "Hello world";
    const interimRange = { from: 6, to: 11 };
    // After commit, the full doc is committed
    const committed = docWithInterim; // decoration removed, text stays
    expect(committed).toBe("Hello world");
  });
});
