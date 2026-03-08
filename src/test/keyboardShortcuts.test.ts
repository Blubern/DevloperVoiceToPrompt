import { describe, it, expect } from "vitest";
import { matchesShortcut, formatShortcutLabel } from "../lib/useKeyboardShortcuts";

// Helper to build a KeyboardEvent with specific modifiers
function keyEvent(
  key: string,
  opts: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    code: opts.code ?? "",
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
  });
}

describe("matchesShortcut", () => {
  it("returns false for empty shortcut string", () => {
    expect(matchesShortcut(keyEvent("r"), "")).toBe(false);
  });

  it("matches a single key without modifiers", () => {
    expect(matchesShortcut(keyEvent("F1"), "F1")).toBe(true);
  });

  it("rejects when extra modifier is pressed but not required", () => {
    expect(matchesShortcut(keyEvent("r", { ctrl: true }), "r")).toBe(false);
  });

  it("matches CommandOrControl with Ctrl on non-Mac", () => {
    const e = keyEvent("v", { ctrl: true });
    expect(matchesShortcut(e, "CommandOrControl+V")).toBe(true);
  });

  it("matches CommandOrControl with Meta (Mac)", () => {
    const e = keyEvent("v", { meta: true });
    expect(matchesShortcut(e, "CommandOrControl+V")).toBe(true);
  });

  it("matches Control modifier specifically", () => {
    const e = keyEvent("c", { ctrl: true });
    expect(matchesShortcut(e, "Control+C")).toBe(true);
  });

  it("rejects Control shortcut when Meta is pressed instead", () => {
    const e = keyEvent("c", { meta: true });
    expect(matchesShortcut(e, "Control+C")).toBe(false);
  });

  it("matches Shift modifier", () => {
    const e = keyEvent("r", { ctrl: true, shift: true });
    expect(matchesShortcut(e, "CommandOrControl+Shift+R")).toBe(true);
  });

  it("rejects when Shift is required but not pressed", () => {
    const e = keyEvent("r", { ctrl: true });
    expect(matchesShortcut(e, "CommandOrControl+Shift+R")).toBe(false);
  });

  it("matches Alt modifier", () => {
    const e = keyEvent("v", { ctrl: true, alt: true });
    expect(matchesShortcut(e, "CommandOrControl+Alt+V")).toBe(true);
  });

  it("rejects when Alt is pressed but not required", () => {
    const e = keyEvent("v", { ctrl: true, alt: true });
    expect(matchesShortcut(e, "CommandOrControl+V")).toBe(false);
  });

  it("matches by e.code as fallback", () => {
    const e = keyEvent("", { ctrl: true, code: "KeyR" });
    expect(matchesShortcut(e, "CommandOrControl+keyr")).toBe(true);
  });

  it("is case-insensitive for key matching", () => {
    const e = keyEvent("R", { ctrl: true });
    expect(matchesShortcut(e, "CommandOrControl+r")).toBe(true);
  });

  it("matches three modifiers simultaneously", () => {
    const e = keyEvent("k", { ctrl: true, shift: true, alt: true });
    expect(matchesShortcut(e, "CommandOrControl+Shift+Alt+K")).toBe(true);
  });

  it("rejects when wrong key is pressed", () => {
    const e = keyEvent("x", { ctrl: true });
    expect(matchesShortcut(e, "CommandOrControl+C")).toBe(false);
  });

  it("matches Enter key", () => {
    const e = keyEvent("Enter", { ctrl: true });
    expect(matchesShortcut(e, "CommandOrControl+Enter")).toBe(true);
  });

  it("matches Meta modifier specifically", () => {
    const e = keyEvent("k", { meta: true });
    expect(matchesShortcut(e, "Meta+K")).toBe(true);
  });
});

describe("formatShortcutLabel", () => {
  it("returns empty for empty input", () => {
    expect(formatShortcutLabel("")).toBe("");
  });

  it("replaces CommandOrControl with Ctrl", () => {
    expect(formatShortcutLabel("CommandOrControl+V")).toBe("Ctrl+V");
  });

  it("replaces Control with Ctrl", () => {
    expect(formatShortcutLabel("Control+C")).toBe("Ctrl+C");
  });

  it("replaces Meta with ⌘", () => {
    expect(formatShortcutLabel("Meta+K")).toBe("⌘+K");
  });

  it("handles multiple modifiers", () => {
    expect(formatShortcutLabel("CommandOrControl+Shift+Alt+R")).toBe("Ctrl+Shift+Alt+R");
  });

  it("preserves plain key names", () => {
    expect(formatShortcutLabel("Shift+F12")).toBe("Shift+F12");
  });

  it("handles case-insensitive replacement", () => {
    expect(formatShortcutLabel("commandorcontrol+v")).toBe("Ctrl+v");
  });
});
