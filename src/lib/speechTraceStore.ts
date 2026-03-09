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
  /** Short event label, e.g. "recognizing", "recognized", "sessionStopped" */
  event: string;
  /** Detail message */
  detail: string;
}

const DEFAULT_MAX_ENTRIES = 500;

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
