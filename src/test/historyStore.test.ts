import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../lib/historyStore";

describe("formatRelativeTime", () => {
  it("returns 'Just now' for timestamps less than 60 seconds ago", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("Just now");
  });

  it("returns minutes ago for timestamps less than an hour ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago for timestamps less than a day ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
  });

  it("returns 'Yesterday' for timestamps from yesterday", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe("Yesterday");
  });

  it("returns days ago for timestamps within a week", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
  });

  it("returns a date for timestamps older than a week", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoWeeksAgo);
    // Should be a date string like "Feb 19" or similar
    expect(result).not.toContain("ago");
    expect(result).not.toBe("Just now");
  });
});
