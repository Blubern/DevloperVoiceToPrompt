import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addHistoryEntry,
  getHistory,
  clearHistory,
  deleteHistoryEntry,
  pruneHistory,
} from "../lib/historyStore";

// The setup.ts mock provides an in-memory store.
// We need to reset it between tests.
beforeEach(async () => {
  await clearHistory();
});

describe("historyStore CRUD", () => {
  it("adds entry with unique id", async () => {
    await addHistoryEntry("Hello world", 50);
    const entries = await getHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("Hello world");
    expect(entries[0].timestamp).toBeTruthy();
    expect(entries[0].id).toBeTruthy();
  });

  it("ignores empty/whitespace-only entries", async () => {
    await addHistoryEntry("", 50);
    await addHistoryEntry("   ", 50);
    const entries = await getHistory();
    expect(entries).toHaveLength(0);
  });

  it("trims text before storing", async () => {
    await addHistoryEntry("  padded text  ", 50);
    const entries = await getHistory();
    expect(entries[0].text).toBe("padded text");
  });

  it("stores input_reason when provided", async () => {
    await addHistoryEntry("MCP text", 50, "voice-request");
    const entries = await getHistory();
    expect(entries[0].input_reason).toBe("voice-request");
  });

  it("does not include input_reason when not provided", async () => {
    await addHistoryEntry("plain text", 50);
    const entries = await getHistory();
    expect(entries[0].input_reason).toBeUndefined();
  });

  it("prepends newest entries first", async () => {
    await addHistoryEntry("first", 50);
    await addHistoryEntry("second", 50);
    const entries = await getHistory();
    expect(entries[0].text).toBe("second");
    expect(entries[1].text).toBe("first");
  });

  it("enforces max entries limit", async () => {
    for (let i = 0; i < 5; i++) {
      await addHistoryEntry(`entry-${i}`, 3);
    }
    const entries = await getHistory();
    expect(entries).toHaveLength(3);
    // Most recent entries are kept
    expect(entries[0].text).toBe("entry-4");
    expect(entries[1].text).toBe("entry-3");
    expect(entries[2].text).toBe("entry-2");
  });

  it("clears all entries", async () => {
    await addHistoryEntry("one", 50);
    await addHistoryEntry("two", 50);
    await clearHistory();
    const entries = await getHistory();
    expect(entries).toHaveLength(0);
  });

  it("deletes a specific entry by id", async () => {
    await addHistoryEntry("keep", 50);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    await addHistoryEntry("delete-me", 50);
    const before = await getHistory();
    expect(before).toHaveLength(2);

    const deleteId = before.find((e) => e.text === "delete-me")!.id;
    await deleteHistoryEntry(deleteId);

    const after = await getHistory();
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe("keep");
  });

  it("deleteHistoryEntry is a no-op for non-existent id", async () => {
    await addHistoryEntry("exists", 50);
    await deleteHistoryEntry("non-existent-id");
    const entries = await getHistory();
    expect(entries).toHaveLength(1);
  });

  it("prunes to max entries", async () => {
    for (let i = 0; i < 10; i++) {
      await addHistoryEntry(`entry-${i}`, 100);
    }
    await pruneHistory(5);
    const entries = await getHistory();
    expect(entries).toHaveLength(5);
  });

  it("pruneHistory is a no-op when under limit", async () => {
    await addHistoryEntry("one", 50);
    await pruneHistory(50);
    const entries = await getHistory();
    expect(entries).toHaveLength(1);
  });
});
