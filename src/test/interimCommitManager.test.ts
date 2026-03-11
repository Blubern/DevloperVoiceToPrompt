import { describe, it, expect, vi, beforeEach } from "vitest";
import { InterimCommitManager, type InterimEditorCallbacks } from "../lib/interimCommitManager";

function createMockEditor(): InterimEditorCallbacks & {
  insertInterimCalls: string[];
  finalizeInterimCalls: string[];
  commitInterimCalls: number;
  _hasInterim: boolean;
} {
  const mock = {
    insertInterimCalls: [] as string[],
    finalizeInterimCalls: [] as string[],
    commitInterimCalls: 0,
    _hasInterim: false,
    insertInterim(text: string) {
      mock.insertInterimCalls.push(text);
      mock._hasInterim = true;
    },
    finalizeInterim(text: string) {
      mock.finalizeInterimCalls.push(text);
      mock._hasInterim = false;
    },
    commitInterim() {
      mock.commitInterimCalls++;
      mock._hasInterim = false;
    },
    hasInterim() {
      return mock._hasInterim;
    },
  };
  return mock;
}

describe("InterimCommitManager", () => {
  let manager: InterimCommitManager;
  let editor: ReturnType<typeof createMockEditor>;
  let segments: string[];

  beforeEach(() => {
    manager = new InterimCommitManager();
    editor = createMockEditor();
    segments = [];
    manager.attach(editor, (text) => segments.push(text));
    // Override Date.now for deterministic tests
    manager.now = () => 1000;
  });

  // ----- Basic lifecycle -----

  it("onInterim → onFinal: text finalized once", () => {
    manager.onProviderInterim("hello world");
    expect(editor.insertInterimCalls).toEqual(["hello world"]);
    expect(editor._hasInterim).toBe(true);

    manager.onProviderFinal("Hello world.");
    expect(editor.finalizeInterimCalls).toEqual(["Hello world."]);
    expect(segments).toEqual(["Hello world."]);
  });

  it("onInterim → commitFromUI → onFinal: no duplicate", () => {
    manager.onProviderInterim("hello world");

    // UI commits (e.g. user clicked outside)
    manager.commitFromUI("cursor-move");
    expect(editor.commitInterimCalls).toBe(1);
    expect(segments).toEqual(["hello world"]);

    // Provider fires onFinal later — should be suppressed
    manager.onProviderFinal("Hello world.");
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual(["hello world"]); // no duplicate
  });

  it("onInterim → commitFromUI → new onInterim → onFinal: fresh cycle", () => {
    manager.onProviderInterim("first");
    manager.commitFromUI("user-edit");
    expect(segments).toEqual(["first"]);

    // New speech starts — resets committed flag
    manager.onProviderInterim("second");
    expect(editor._hasInterim).toBe(true);

    manager.onProviderFinal("Second.");
    expect(editor.finalizeInterimCalls).toEqual(["Second."]);
    expect(segments).toEqual(["first", "Second."]);
  });

  // ----- Deadline-based flush -----

  it("maybeFlushExpired: flushes after deadline", () => {
    manager.now = () => 1000;
    manager.onProviderInterim("stale text");

    // Not yet expired
    manager.now = () => 2500;
    manager.maybeFlushExpired("test");
    expect(editor.finalizeInterimCalls).toEqual([]);

    // Expired (>= 2000ms)
    manager.now = () => 3000;
    manager.maybeFlushExpired("test");
    expect(editor.finalizeInterimCalls).toEqual(["stale text"]);
    expect(segments).toEqual(["stale text"]);
  });

  it("maybeFlushExpired: no flush if UI already committed", () => {
    manager.now = () => 1000;
    manager.onProviderInterim("text");
    manager.commitFromUI("user-edit");

    manager.now = () => 5000;
    manager.maybeFlushExpired("test");
    // No duplicate finalization
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual(["text"]);
  });

  it("maybeFlushExpired: no flush when no pending interim", () => {
    manager.now = () => 5000;
    manager.maybeFlushExpired("test");
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual([]);
  });

  // ----- expireDeadline (speechEndDetected) -----

  it("expireDeadline + recognized: recognized wins", () => {
    manager.now = () => 1000;
    manager.onProviderInterim("test speech");

    // speechEndDetected expires the deadline
    manager.expireDeadline();

    // recognized arrives immediately after with proper text
    manager.onProviderFinal("Test speech.");
    expect(editor.finalizeInterimCalls).toEqual(["Test speech."]);
    expect(segments).toEqual(["Test speech."]);
  });

  it("expireDeadline + no recognized: next event flushes", () => {
    manager.now = () => 1000;
    manager.onProviderInterim("test speech");

    // speechEndDetected expires the deadline
    manager.now = () => 2000;
    manager.expireDeadline();

    // No recognized arrives; next event checks deadline
    manager.now = () => 2100;
    manager.maybeFlushExpired("recognizing-check");
    expect(editor.finalizeInterimCalls).toEqual(["test speech"]);
    expect(segments).toEqual(["test speech"]);
  });

  // ----- Multiple interims -----

  it("multiple onInterim → onFinal: only last interim matters", () => {
    manager.onProviderInterim("hel");
    manager.onProviderInterim("hello");
    manager.onProviderInterim("hello world");

    manager.onProviderFinal("Hello world.");
    expect(editor.insertInterimCalls).toEqual(["hel", "hello", "hello world"]);
    expect(editor.finalizeInterimCalls).toEqual(["Hello world."]);
    expect(segments).toEqual(["Hello world."]);
  });

  // ----- Guard: no interim decoration -----

  it("onFinal when editor has no interim decoration: skipped", () => {
    // Simulate: interim decoration was already removed externally
    manager.onProviderInterim("some text");
    editor._hasInterim = false; // externally removed

    manager.onProviderFinal("Some text.");
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual([]);
  });

  // ----- Empty/null handling -----

  it("empty onInterim is ignored", () => {
    manager.onProviderInterim("");
    expect(editor.insertInterimCalls).toEqual([]);
  });

  it("empty onFinal is ignored", () => {
    manager.onProviderInterim("text");
    manager.onProviderFinal("");
    expect(editor.finalizeInterimCalls).toEqual([]);
  });

  // ----- commitFromUI when no interim -----

  it("commitFromUI when no interim is a no-op", () => {
    manager.commitFromUI("user-edit");
    expect(editor.commitInterimCalls).toBe(0);
    expect(segments).toEqual([]);
  });

  // ----- cursor-move: decoration removed before commitFromUI -----

  it("cursor-move: decoration already removed before commitFromUI", () => {
    manager.onProviderInterim("some text here");
    expect(editor._hasInterim).toBe(true);

    // Simulate autoCommitOnCursorMove: editor removes decoration first
    editor._hasInterim = false;

    // Then oncommit fires → commitFromUI
    manager.commitFromUI("cursor-move");
    // Should NOT call editor.commitInterim (decoration already gone)
    expect(editor.commitInterimCalls).toBe(0);
    // But SHOULD set uiCommitted and record the segment
    expect(segments).toEqual(["some text here"]);

    // Late provider onFinal should be suppressed
    manager.onProviderFinal("Some text here.");
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual(["some text here"]); // no duplicate
  });

  it("cursor-move + turn-boundary onFinal: no duplicate, no text loss", () => {
    manager.onProviderInterim("first segment text");

    // Simulate: user clicks outside interim → decoration removed by editor
    editor._hasInterim = false;
    // oncommit callback fires
    manager.commitFromUI("cursor-move");
    expect(segments).toEqual(["first segment text"]);

    // Provider fires turn-boundary flush (same text) via onFinal
    manager.onProviderFinal("first segment text");
    // No duplicate
    expect(segments).toEqual(["first segment text"]);
    expect(editor.finalizeInterimCalls).toEqual([]);

    // New speech starts — fresh cycle works normally
    manager.onProviderInterim("second");
    expect(editor._hasInterim).toBe(true);
    manager.onProviderFinal("Second.");
    expect(editor.finalizeInterimCalls).toEqual(["Second."]);
    expect(segments).toEqual(["first segment text", "Second."]);
  });

  // ----- detach cleans state -----

  it("detach resets state", () => {
    manager.onProviderInterim("text");
    manager.detach();
    expect(manager.hasPendingInterim()).toBe(false);
  });

  // ----- Mid-turn prefix stripping after cursor-move commit -----

  it("mid-turn cursor-move: subsequent interims strip committed prefix", () => {
    manager.onProviderInterim("hello world");

    // User clicks outside interim
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");
    expect(segments).toEqual(["hello world"]);

    // Azure sends next interim with full turn text including committed prefix
    manager.onProviderInterim("hello world and more");
    // Editor should only get the delta, not the committed prefix
    expect(editor.insertInterimCalls).toEqual(["hello world", "and more"]);
  });

  it("mid-turn cursor-move: exact duplicate interim is suppressed", () => {
    manager.onProviderInterim("hello world");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // Azure re-sends the exact same text
    manager.onProviderInterim("hello world");
    // Should not insert anything (delta is empty)
    expect(editor.insertInterimCalls).toEqual(["hello world"]); // only the original
  });

  it("mid-turn cursor-move: unrelated next interim = new turn", () => {
    manager.onProviderInterim("first turn text");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // Azure sends a completely different interim (new turn)
    manager.onProviderInterim("second turn");
    // Full text should be inserted (prefix doesn't match)
    expect(editor.insertInterimCalls).toEqual(["first turn text", "second turn"]);
  });

  it("mid-turn cursor-move: prefix cleared on provider final", () => {
    manager.onProviderInterim("hello");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // Provider fires onFinal — skipped (uiCommitted), prefix cleared
    manager.onProviderFinal("Hello.");
    expect(editor.finalizeInterimCalls).toEqual([]);

    // New turn: should not attempt prefix stripping
    manager.onProviderInterim("new text");
    expect(editor.insertInterimCalls).toEqual(["hello", "new text"]);
  });

  it("mid-turn cursor-move: case-insensitive prefix matching", () => {
    manager.onProviderInterim("hello world");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // Azure changes casing in subsequent interim
    manager.onProviderInterim("Hello world and more stuff");
    // Should still strip the prefix despite case difference
    expect(editor.insertInterimCalls).toEqual(["hello world", "and more stuff"]);
  });

  // ----- hasPendingInterim -----

  it("hasPendingInterim reflects state", () => {
    expect(manager.hasPendingInterim()).toBe(false);
    manager.onProviderInterim("text");
    expect(manager.hasPendingInterim()).toBe(true);
    manager.onProviderFinal("Text.");
    expect(manager.hasPendingInterim()).toBe(false);
  });

  // ----- onProviderFinal prefix stripping -----

  it("mid-turn cursor-move: onProviderFinal strips committed prefix", () => {
    manager.onProviderInterim("And now I have one thing I");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");
    expect(segments).toEqual(["And now I have one thing I"]);

    // Subsequent interims arrive (prefix-stripped)
    manager.onProviderInterim("And now I have one thing I want to test");
    expect(editor.insertInterimCalls[1]).toBe("want to test");

    // Provider sends full-turn final text including committed prefix
    manager.onProviderFinal("And now I have one thing I want to test, I click somewhere.");
    // Should only finalize the delta, not the full text
    expect(editor.finalizeInterimCalls).toEqual(["want to test, I click somewhere."]);
    expect(segments).toEqual(["And now I have one thing I", "want to test, I click somewhere."]);
  });

  it("mid-turn cursor-move: onProviderFinal exact duplicate suppressed", () => {
    manager.onProviderInterim("hello world");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // Provider sends final with same text as committed prefix
    // Need interim decoration for onProviderFinal to proceed
    manager.onProviderInterim("hello world");
    // Exact dup interim is suppressed, so hasInterim stays false
    // → onProviderFinal will hit skip-final-no-interim guard.
    // Test the direct case: committedPrefix still set, no new interims
    editor._hasInterim = true;
    manager.onProviderFinal("hello world");
    expect(editor.finalizeInterimCalls).toEqual([]);
    expect(segments).toEqual(["hello world"]); // only the UI commit, no duplicate
  });

  it("mid-turn cursor-move: onProviderFinal with unrelated text = full insert", () => {
    manager.onProviderInterim("first turn text");
    editor._hasInterim = false;
    manager.commitFromUI("cursor-move");

    // New turn starts with different text
    manager.onProviderInterim("second turn");
    expect(editor.insertInterimCalls).toEqual(["first turn text", "second turn"]);

    // Provider finalizes with different text (not matching committed prefix)
    manager.onProviderFinal("Second turn.");
    // Full text finalized (prefix was already cleared because interim didn't match)
    expect(editor.finalizeInterimCalls).toEqual(["Second turn."]);
    expect(segments).toEqual(["first turn text", "Second turn."]);
  });
});
