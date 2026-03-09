/**
 * Tests that verify store promise retry-on-rejection behavior.
 *
 * Bug: getStore() cached the promise from load(). If the first call rejected,
 * the rejected promise was cached forever — all subsequent operations failed
 * permanently with no recovery.
 *
 * Fix: Reset storePromise = null in a .catch() handler before re-throwing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { load } from "@tauri-apps/plugin-store";

// We test each store module independently by dynamically importing after
// configuring the mock. Each module caches its own storePromise.

const mockedLoad = vi.mocked(load);

describe("historyStore recovery after load failure", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("recovers after a transient load failure", async () => {
    // First call: load rejects
    mockedLoad.mockRejectedValueOnce(new Error("file locked"));

    const { getHistory } = await import("../lib/historyStore");

    // First call should fail
    await expect(getHistory()).rejects.toThrow("file locked");

    // Reset the mock to succeed on retry
    const fakeStore = {
      get: vi.fn(() => Promise.resolve([{ timestamp: "2026-01-01", text: "hello" }])),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValueOnce(fakeStore as any);

    // Second call should succeed (storePromise was reset)
    const entries = await getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("hello");

    // load() was called twice — once for the failed attempt, once for the retry
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });

  it("caches the store on success (no repeat loads)", async () => {
    const fakeStore = {
      get: vi.fn(() => Promise.resolve([])),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValue(fakeStore as any);

    const { getHistory, clearHistory } = await import("../lib/historyStore");

    await getHistory();
    await clearHistory();
    await getHistory();

    // load() should only be called once — the promise is cached after success
    expect(mockedLoad).toHaveBeenCalledTimes(1);
  });
});

describe("templateStore recovery after load failure", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("recovers after a transient load failure", async () => {
    mockedLoad.mockRejectedValueOnce(new Error("disk error"));

    const { getTemplates } = await import("../lib/templateStore");

    await expect(getTemplates()).rejects.toThrow("disk error");

    const fakeStore = {
      get: vi.fn(() => Promise.resolve([])),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValueOnce(fakeStore as any);

    const templates = await getTemplates();
    expect(templates).toEqual([]);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });
});

describe("usageStore recovery after load failure", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("recovers after a transient load failure", async () => {
    mockedLoad.mockRejectedValueOnce(new Error("permission denied"));

    const { getUsageStats } = await import("../lib/usageStore");

    await expect(getUsageStats()).rejects.toThrow("permission denied");

    const fakeStore = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValueOnce(fakeStore as any);

    const stats = await getUsageStats();
    expect(stats.total.today).toBe(0);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });
});

describe("enhancerTemplateStore recovery after load failure", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("recovers after a transient load failure", async () => {
    mockedLoad.mockRejectedValueOnce(new Error("corrupted"));

    const { getEnhancerTemplates } = await import("../lib/enhancerTemplateStore");

    await expect(getEnhancerTemplates()).rejects.toThrow("corrupted");

    const fakeStore = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValueOnce(fakeStore as any);

    // Should seed defaults on successful retry
    const templates = await getEnhancerTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(mockedLoad).toHaveBeenCalledTimes(2);
  });
});
