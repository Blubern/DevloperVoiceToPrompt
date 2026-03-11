// ---------------------------------------------------------------------------
// Speech trace store — in-memory ring buffer for debugging speech sessions
// ---------------------------------------------------------------------------

export interface SpeechTraceEntry {
  /** Millisecond timestamp (performance.now() for sub-ms precision) */
  ts: number;
  /** Wall-clock time string for display */
  time: string;
  /** Trace level */
  level: "info" | "warn" | "event" | "data";
  /** Short event label, e.g. "session:start", "result:final", "mic:muted" */
  event: string;
  /** Detail message */
  detail: string;
}

const DEFAULT_MAX_ENTRIES = 500;
const SESSION_START_EVENT = "session:start";
const SESSION_STOPPED_EVENT = "session:stopped";

let _maxEntries = DEFAULT_MAX_ENTRIES;
let _entries: SpeechTraceEntry[] = [];
let _enabled = false;
let _version = 0;
let _listeners: Set<() => void> = new Set();

function now(): string {
  const d = new Date();
  return (
    d.getHours().toString().padStart(2, "0") +
    ":" +
    d.getMinutes().toString().padStart(2, "0") +
    ":" +
    d.getSeconds().toString().padStart(2, "0") +
    "." +
    d.getMilliseconds().toString().padStart(3, "0")
  );
}

export function setTracingEnabled(enabled: boolean): void {
  _enabled = enabled;
}

export function setMaxEntries(max: number): void {
  _maxEntries = Math.max(50, Math.min(max, 10000));
  if (_entries.length > _maxEntries) {
    _entries = _entries.slice(-_maxEntries);
    _notify();
  }
}

export function isTracingEnabled(): boolean {
  return _enabled;
}

export function traceEvent(
  level: SpeechTraceEntry["level"],
  event: string,
  detail: string,
): void {
  if (!_enabled) return;
  const entry: SpeechTraceEntry = {
    ts: performance.now(),
    time: now(),
    level,
    event,
    detail,
  };
  _entries.push(entry);
  if (_entries.length > _maxEntries) {
    _entries = _entries.slice(-_maxEntries);
  }
  _version++;
  _notify();
}

export function getTraceEntries(): SpeechTraceEntry[] {
  return _entries;
}

export function getLatestCompletedSessionEntries(entries: SpeechTraceEntry[] = _entries): SpeechTraceEntry[] {
  const sessions = getSessionRanges(entries);
  const latestCompletedSession = [...sessions].reverse().find((session) => session.completed);

  return latestCompletedSession ? entries.slice(latestCompletedSession.start, latestCompletedSession.end) : [];
}

export function getCurrentActiveSessionEntries(entries: SpeechTraceEntry[] = _entries): SpeechTraceEntry[] {
  const sessions = getSessionRanges(entries);
  const latestSession = sessions.at(-1);

  if (!latestSession || latestSession.completed) {
    return [];
  }

  return entries.slice(latestSession.start, latestSession.end);
}

export function formatTraceEntries(entries: SpeechTraceEntry[]): string {
  return entries
    .map((entry) => `${entry.time} [${entry.level}] ${entry.event}: ${entry.detail}`)
    .join("\n");
}

export function getTraceVersion(): number {
  return _version;
}

export function clearTrace(): void {
  _entries = [];
  _version++;
  _notify();
}

/** Subscribe to trace updates. Returns an unsubscribe function. */
export function subscribeTrace(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify(): void {
  for (const fn of _listeners) fn();
}

function getSessionRanges(entries: SpeechTraceEntry[]): Array<{ start: number; end: number; completed: boolean }> {
  const starts: number[] = [];

  for (let index = 0; index < entries.length; index++) {
    if (entries[index]?.event === SESSION_START_EVENT) {
      starts.push(index);
    }
  }

  return starts.map((start, index) => {
    const nextStart = starts[index + 1] ?? entries.length;
    const completed = entries.slice(start, nextStart).some((entry) => entry.event === SESSION_STOPPED_EVENT);

    return {
      start,
      end: nextStart,
      completed,
    };
  });
}
