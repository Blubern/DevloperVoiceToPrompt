// ---------------------------------------------------------------------------
// InterimCommitManager — single source of truth for interim text lifecycle
// ---------------------------------------------------------------------------
//
// Owns the coordination between speech providers and the editor so that:
// 1. Interim text is never duplicated (dedup guard via `uiCommitted` flag).
// 2. Expired interim is flushed via deadline check + active timer.
// 3. Behaviour is provider-agnostic and fully unit-testable.

import { traceEvent } from "./speechTraceStore";

/** Deadline after which an interim with no new recognizing events is flushed. */
const INTERIM_DEADLINE_MS = 2000;

// ---------------------------------------------------------------------------
// Callbacks injected by the host (Popup.svelte)
// ---------------------------------------------------------------------------

export interface InterimEditorCallbacks {
  /** Insert or replace interim text in the editor (decoration visible). */
  insertInterim(text: string): void;
  /** Replace the decorated interim range with the provider's final text.
   *  If the interim decoration was already removed (UI committed), this
   *  inserts at the dictation anchor — the manager prevents this by
   *  checking `hasInterim` first. */
  finalizeInterim(text: string): void;
  /** Remove the interim decoration, leaving the text in the document. */
  commitInterim(): void;
  /** Whether the editor currently has an interim decoration. */
  hasInterim(): boolean;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class InterimCommitManager {
  // Provider-side shadow state (mirrors what the provider would track)
  private lastInterimText = "";
  private lastInterimTimestamp = 0;
  /** Set when the UI commits the interim (edit, cursor-move, stop).
   *  Prevents a late provider `onFinal` from inserting a duplicate. */
  private uiCommitted = false;
  /** When a mid-turn UI commit happens, this stores the committed text.
   *  Subsequent `onProviderInterim` calls whose text starts with this
   *  prefix will strip the prefix to avoid re-inserting committed text. */
  private committedPrefix = "";
  /** Active timer that calls maybeFlushExpired.  Ensures the deadline
   *  fires even when no external events wake the renderer. */
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  private editor: InterimEditorCallbacks | null = null;
  private onSegmentFinalized: ((text: string) => void) | null = null;

  /** Bound event handlers for visibilitychange / focus. */
  private boundOnVisibilityChange: (() => void) | null = null;
  private boundOnFocus: (() => void) | null = null;

  // Allow overriding Date.now for tests
  now: () => number = Date.now;

  // -----------------------------------------------------------------------
  // Setup / teardown
  // -----------------------------------------------------------------------

  /**
   * Attach the manager to the editor and register page-lifecycle listeners.
   * Call once when starting a recording session.
   *
   * @param editor  Functions to manipulate the editor's interim state.
   * @param onSegmentFinalized  Called when a segment is finalized (for
   *   tracking `finalSegments` in Popup).
   */
  attach(editor: InterimEditorCallbacks, onSegmentFinalized: (text: string) => void): void {
    this.editor = editor;
    this.onSegmentFinalized = onSegmentFinalized;
    this.reset();
    this.addPageListeners();
  }

  /** Detach editor, remove page listeners, reset state. */
  detach(): void {
    this.removePageListeners();
    this.editor = null;
    this.onSegmentFinalized = null;
    this.reset();
  }

  /** Reset internal state (e.g. between sessions). */
  reset(): void {
    this.lastInterimText = "";
    this.lastInterimTimestamp = 0;
    this.uiCommitted = false;
  }

  // -----------------------------------------------------------------------
  // Provider → Manager  (speech providers call these)
  // -----------------------------------------------------------------------

  /** A new partial/interim result arrived from the provider. */
  onProviderInterim(text: string): void {
    if (!text || !this.editor) return;

    // Mid-turn prefix stripping: if the UI committed text mid-turn,
    // Azure's next interim contains the full turn including the committed
    // prefix.  Strip it to avoid re-inserting already-committed text.
    if (this.committedPrefix) {
      if (text.toLowerCase().startsWith(this.committedPrefix.toLowerCase())) {
        const delta = text.slice(this.committedPrefix.length).trimStart();
        // Track full turn text for turn-boundary detection.
        this.lastInterimText = text;
        this.lastInterimTimestamp = this.now();
        if (!delta) {
          // Exact duplicate of committed text — suppress entirely.
          return;
        }
        this.uiCommitted = false;
        this.editor.insertInterim(delta);
        this.scheduleDeadlineTimer(); 
        return;
      }
      // Text doesn't share the prefix — new turn, clear prefix.
      this.committedPrefix = "";
    }

    // Normal path: fresh interim.
    this.uiCommitted = false;
    this.lastInterimText = text;
    this.lastInterimTimestamp = this.now();
    this.editor.insertInterim(text);
    this.scheduleDeadlineTimer();
  }

  /**
   * The provider produced a final result for the current turn.
   * If the UI already committed the interim, skip the duplicate insert.
   */
  onProviderFinal(text: string): void {
    if (!text || !this.editor) return;

    if (this.uiCommitted) {
      // The editor already committed this interim — do NOT insert again.
      traceEvent("info", "icm:skip-final", `Skipping provider final (${text.length} chars) — UI already committed`);
      this.lastInterimText = "";
      this.lastInterimTimestamp = 0;
      this.committedPrefix = "";
      this.clearDeadlineTimer();
      return;
    }

    // Guard: if the editor no longer has an interim decoration (e.g. cursor
    // moved and auto-committed), inserting via finalizeInterim would create a
    // duplicate at the anchor.  Treat as already-committed.
    if (!this.editor.hasInterim()) {
      traceEvent("info", "icm:skip-final-no-interim", `Skipping provider final (${text.length} chars) \u2014 no interim decoration in editor`);
      this.lastInterimText = "";
      this.lastInterimTimestamp = 0;
      this.clearDeadlineTimer();
      return;
    }

    traceEvent("data", "icm:finalize", `finalize (${text.length} chars): ${text.slice(0, 100)}${text.length > 100 ? "…" : ""}`);

    // Mid-turn prefix stripping: if a cursor-move commit happened mid-turn,
    // the provider's final text contains the full turn including the
    // already-committed prefix.  Strip it to avoid duplication.
    let finalText = text;
    if (this.committedPrefix) {
      if (text.toLowerCase().startsWith(this.committedPrefix.toLowerCase())) {
        const delta = text.slice(this.committedPrefix.length).trimStart();
        if (!delta) {
          // Exact duplicate of committed text \u2014 nothing new to insert.
          traceEvent("info", "icm:skip-final-prefix-dup", `Skipping provider final (${text.length} chars) \u2014 exact duplicate of committed prefix`);
          this.lastInterimText = "";
          this.lastInterimTimestamp = 0;
          this.committedPrefix = "";
          return;
        }
        finalText = delta;
      }
      this.committedPrefix = "";
    }

    this.editor.finalizeInterim(finalText);
    this.onSegmentFinalized?.(finalText);
    this.lastInterimText = "";
    this.lastInterimTimestamp = 0;
    this.uiCommitted = false;
    this.committedPrefix = "";
    this.clearDeadlineTimer();
  }

  // -----------------------------------------------------------------------
  // UI → Manager  (editor/popup calls these)
  // -----------------------------------------------------------------------

  /**
   * The UI is committing the interim text (user typed, clicked outside the
   * interim range, or recording stopped).  Mark as committed so a late
   * provider `onFinal` is suppressed.
   */
  commitFromUI(source: string): void {
    if (!this.editor) return;
    // Guard on the manager's own state, not the editor's decoration.
    // The decoration may already be removed (e.g. autoCommitOnCursorMove
    // in DictationEditor removes it before calling oncommit).
    if (!this.lastInterimText) return;

    traceEvent("info", `icm:commit-ui`, `UI commit (${source}), interim=${this.lastInterimText.length} chars`);
    // Only call editor.commitInterim if the decoration is still present.
    if (this.editor.hasInterim()) {
      this.editor.commitInterim();
    }
    this.uiCommitted = true;
    // Store the committed text as a prefix so subsequent interims from the
    // same Azure turn can strip the already-committed portion.
    this.committedPrefix = this.lastInterimText;
    // The text is already in the document — record as a finalized segment.
    this.onSegmentFinalized?.(this.lastInterimText);
    this.lastInterimText = "";
    this.lastInterimTimestamp = 0;
    this.clearDeadlineTimer();
  }

  // -----------------------------------------------------------------------
  // Deadline-based flush  (called on any renderer-wake event)
  // -----------------------------------------------------------------------

  /** Check if the pending interim has exceeded the deadline; flush if so.
   *  Safe to call frequently — it's a cheap timestamp comparison. */
  maybeFlushExpired(source: string): void {
    if (
      this.lastInterimText &&
      this.lastInterimTimestamp > 0 &&
      this.now() - this.lastInterimTimestamp >= INTERIM_DEADLINE_MS
    ) {
      const age = this.now() - this.lastInterimTimestamp;
      traceEvent("warn", `icm:flush-expired`, `Deadline expired (${source}, age=${age}ms), flushing interim (${this.lastInterimText.length} chars)`);
      this.clearDeadlineTimer();
      this.onProviderFinal(this.lastInterimText);
    }
  }

  /**
   * Force-expire the deadline without flushing.  Used by Azure's
   * `speechEndDetected` — `recognized` usually follows within <100ms
   * with properly capitalized/punctuated text.  If it doesn't, the
   * next event that calls `maybeFlushExpired` will commit.
   */
  expireDeadline(): void {
    if (this.lastInterimText && this.lastInterimTimestamp > 0) {
      // Set timestamp to 1 so it passes the > 0 guard, and is old enough
      // that any future now() - 1 >= INTERIM_DEADLINE_MS is trivially true.
      this.lastInterimTimestamp = 1;
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /** Whether there is pending interim text that hasn't been committed. */
  hasPendingInterim(): boolean {
    return this.lastInterimText.length > 0;
  }

  /** The current pending interim text (for provider reconciliation). */
  getPendingInterimText(): string {
    return this.lastInterimText;
  }

  // -----------------------------------------------------------------------
  // Deadline timer
  // -----------------------------------------------------------------------

  /** Schedule a setTimeout that will call maybeFlushExpired after the
   *  deadline.  Resets on every new interim.  This is the active polling
   *  mechanism that ensures commits happen even when no external events
   *  (WebSocket messages, user interaction) wake the renderer. */
  private scheduleDeadlineTimer(): void {
    this.clearDeadlineTimer();
    this.deadlineTimer = setTimeout(() => {
      this.deadlineTimer = null;
      this.maybeFlushExpired("deadline-timer");
    }, INTERIM_DEADLINE_MS + 100); // +100ms buffer for timing jitter
  }

  private clearDeadlineTimer(): void {
    if (this.deadlineTimer !== null) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Page-lifecycle listeners
  // -----------------------------------------------------------------------

  private addPageListeners(): void {
    this.removePageListeners();
    this.boundOnVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        this.maybeFlushExpired("visibilitychange");
      }
    };
    this.boundOnFocus = () => this.maybeFlushExpired("focus");
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundOnVisibilityChange);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", this.boundOnFocus);
    }
  }

  private removePageListeners(): void {
    if (this.boundOnVisibilityChange && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundOnVisibilityChange);
      this.boundOnVisibilityChange = null;
    }
    if (this.boundOnFocus && typeof window !== "undefined") {
      window.removeEventListener("focus", this.boundOnFocus);
      this.boundOnFocus = null;
    }
  }
}
