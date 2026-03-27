import { describe, it, expect } from "vitest";
import {
  PROVIDER_OS,
  PROVIDER_AZURE,
  PROVIDER_WHISPER,
  cycleProvider,
  providerLabel,
  WINDOW_MAIN,
  WINDOW_POPUP,
} from "../lib/constants";
import { matchesShortcut, formatShortcutLabel } from "../lib/useKeyboardShortcuts";

describe("constants", () => {
  it("has correct provider string values", () => {
    expect(PROVIDER_OS).toBe("os");
    expect(PROVIDER_AZURE).toBe("azure");
    expect(PROVIDER_WHISPER).toBe("whisper");
  });

  it("has correct window labels", () => {
    expect(WINDOW_MAIN).toBe("main");
    expect(WINDOW_POPUP).toBe("popup");
  });
});

describe("cycleProvider", () => {
  it("cycles os -> azure -> whisper -> os", () => {
    expect(cycleProvider(PROVIDER_OS)).toBe(PROVIDER_AZURE);
    expect(cycleProvider(PROVIDER_AZURE)).toBe(PROVIDER_WHISPER);
    expect(cycleProvider(PROVIDER_WHISPER)).toBe(PROVIDER_OS);
  });
});

describe("providerLabel", () => {
  it("returns human-readable labels", () => {
    expect(providerLabel(PROVIDER_OS)).toBe("Web Speech");
    expect(providerLabel(PROVIDER_AZURE)).toBe("Azure");
    expect(providerLabel(PROVIDER_WHISPER)).toBe("Whisper");
  });
});

describe("formatShortcutLabel", () => {
  it("replaces CommandOrControl with Ctrl", () => {
    expect(formatShortcutLabel("CommandOrControl+Shift+R")).toBe("Ctrl+Shift+R");
  });

  it("returns empty for empty input", () => {
    expect(formatShortcutLabel("")).toBe("");
  });

  it("replaces Meta with ⌘", () => {
    expect(formatShortcutLabel("Meta+K")).toBe("⌘+K");
  });
});

describe("matchesShortcut", () => {
  it("returns false for empty shortcut", () => {
    const e = new KeyboardEvent("keydown", { key: "r" });
    expect(matchesShortcut(e, "")).toBe(false);
  });
});
