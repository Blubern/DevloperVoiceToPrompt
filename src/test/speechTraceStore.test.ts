import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearTrace,
  formatTraceEntries,
  getCurrentActiveSessionEntries,
  getLatestCompletedSessionEntries,
  getTraceEntries,
  setMaxEntries,
  setTracingEnabled,
  traceEvent,
} from "../lib/speechTraceStore";

describe("speechTraceStore session selectors", () => {
  beforeEach(() => {
    clearTrace();
    setTracingEnabled(true);
    setMaxEntries(500);
  });

  afterEach(() => {
    clearTrace();
    setTracingEnabled(false);
    setMaxEntries(500);
  });

  it("returns empty session slices when no session markers exist", () => {
    traceEvent("info", "transport:connected", "connected");

    expect(getLatestCompletedSessionEntries()).toEqual([]);
    expect(getCurrentActiveSessionEntries()).toEqual([]);
  });

  it("returns the latest completed session when multiple sessions exist", () => {
    traceEvent("info", "session:start", "session 1");
    traceEvent("event", "result:interim", "hello");
    traceEvent("event", "session:stopped", "stopped 1");
    traceEvent("info", "session:start", "session 2");
    traceEvent("data", "result:final", "world");
    traceEvent("event", "session:stopped", "stopped 2");

    const completedSession = getLatestCompletedSessionEntries();

    expect(completedSession.map((entry) => entry.event)).toEqual([
      "session:start",
      "result:final",
      "session:stopped",
    ]);
    expect(completedSession[0]?.detail).toBe("session 2");
  });

  it("returns the current active session without mixing in the last completed one", () => {
    traceEvent("info", "session:start", "session 1");
    traceEvent("data", "result:final", "done");
    traceEvent("event", "session:stopped", "stopped 1");
    traceEvent("info", "session:start", "session 2");
    traceEvent("event", "result:interim", "still listening");

    const activeSession = getCurrentActiveSessionEntries();
    const completedSession = getLatestCompletedSessionEntries();

    expect(activeSession.map((entry) => entry.event)).toEqual([
      "session:start",
      "result:interim",
    ]);
    expect(activeSession[0]?.detail).toBe("session 2");
    expect(completedSession[0]?.detail).toBe("session 1");
  });

  it("returns no active session when the session start fell out of the ring buffer", () => {
    setMaxEntries(50);

    traceEvent("info", "session:start", "truncated session");
    for (let index = 0; index < 55; index++) {
      traceEvent("event", `filler:${index}`, `entry ${index}`);
    }

    expect(getCurrentActiveSessionEntries()).toEqual([]);
  });

  it("formats trace entries using the shared clipboard serializer", () => {
    traceEvent("info", "session:start", "session 1");
    traceEvent("event", "session:stopped", "stopped 1");

    const formatted = formatTraceEntries(getLatestCompletedSessionEntries());

    expect(formatted).toContain("[info] session:start: session 1");
    expect(formatted).toContain("[event] session:stopped: stopped 1");
  });

  it("derives session slices correctly from an explicit entry snapshot", () => {
    traceEvent("info", "session:start", "snapshot session");
    traceEvent("event", "result:interim", "in progress");

    const snapshot = [...getTraceEntries()];

    expect(getCurrentActiveSessionEntries(snapshot).map((entry) => entry.event)).toEqual([
      "session:start",
      "result:interim",
    ]);
    expect(getLatestCompletedSessionEntries(snapshot)).toEqual([]);
  });

  it("keeps the latest completed session bounded even when a new active session exists", () => {
    traceEvent("info", "session:start", "session 1");
    traceEvent("data", "result:final", "done 1");
    traceEvent("event", "session:stopped", "stopped 1");
    traceEvent("info", "session:start", "session 2");
    traceEvent("event", "result:interim", "listening 2");

    const completedSession = getLatestCompletedSessionEntries();

    expect(completedSession.map((entry) => entry.detail)).toEqual([
      "session 1",
      "done 1",
      "stopped 1",
    ]);
  });
});