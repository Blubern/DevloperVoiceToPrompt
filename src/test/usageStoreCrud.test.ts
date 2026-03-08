import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  recordUsage,
  getUsageStats,
  resetUsage,
  pruneOldEntries,
  formatDuration,
} from "../lib/usageStore";

beforeEach(async () => {
  await resetUsage();
});

describe("recordUsage", () => {
  it("records positive seconds for web provider", async () => {
    await recordUsage(10, "os");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(10);
  });

  it("records positive seconds for azure provider", async () => {
    await recordUsage(20, "azure");
    const stats = await getUsageStats();
    expect(stats.azure.today).toBe(20);
  });

  it("records positive seconds for whisper provider", async () => {
    await recordUsage(30, "whisper");
    const stats = await getUsageStats();
    expect(stats.whisper.today).toBe(30);
  });

  it("ignores zero seconds", async () => {
    await recordUsage(0, "os");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(0);
  });

  it("ignores negative seconds", async () => {
    await recordUsage(-5, "os");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(0);
  });

  it("accumulates multiple recordings on the same day", async () => {
    await recordUsage(10, "os");
    await recordUsage(15, "os");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(25);
  });

  it("isolates usage per provider", async () => {
    await recordUsage(10, "os");
    await recordUsage(20, "azure");
    await recordUsage(30, "whisper");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(10);
    expect(stats.azure.today).toBe(20);
    expect(stats.whisper.today).toBe(30);
  });
});

describe("getUsageStats aggregation", () => {
  it("returns zero stats when no usage recorded", async () => {
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(0);
    expect(stats.web.thisWeek).toBe(0);
    expect(stats.web.last30Days).toBe(0);
    expect(stats.total.today).toBe(0);
  });

  it("today's usage appears in all three time windows", async () => {
    await recordUsage(60, "os");
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(60);
    expect(stats.web.thisWeek).toBeGreaterThanOrEqual(60);
    expect(stats.web.last30Days).toBeGreaterThanOrEqual(60);
  });

  it("computes total across all providers", async () => {
    await recordUsage(10, "os");
    await recordUsage(20, "azure");
    await recordUsage(30, "whisper");
    const stats = await getUsageStats();
    expect(stats.total.today).toBe(60);
  });
});

describe("resetUsage", () => {
  it("clears all provider stats to zero", async () => {
    await recordUsage(100, "os");
    await recordUsage(200, "azure");
    await recordUsage(300, "whisper");
    await resetUsage();
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(0);
    expect(stats.azure.today).toBe(0);
    expect(stats.whisper.today).toBe(0);
    expect(stats.total.today).toBe(0);
    expect(stats.total.thisWeek).toBe(0);
    expect(stats.total.last30Days).toBe(0);
  });
});

describe("pruneOldEntries", () => {
  it("does not remove recent entries", async () => {
    await recordUsage(50, "os");
    await pruneOldEntries();
    const stats = await getUsageStats();
    expect(stats.web.today).toBe(50);
  });
});

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("formats zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats exact minutes", () => {
    expect(formatDuration(120)).toBe("2m 0s");
  });

  it("formats large durations", () => {
    expect(formatDuration(3661)).toBe("61m 1s");
  });
});
