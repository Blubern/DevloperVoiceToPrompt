import { describe, it, expect } from "vitest";
import { formatDuration } from "../lib/usageStore";

describe("formatDuration", () => {
  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125)).toBe("2m 5s");
  });

  it("handles zero", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("handles exact minutes", () => {
    expect(formatDuration(120)).toBe("2m 0s");
  });
});
