/**
 * Parse a Tauri-format shortcut string and match against a KeyboardEvent.
 * Example: matchesShortcut(event, "CommandOrControl+Shift+R")
 */
export function matchesShortcut(e: KeyboardEvent, shortcutStr: string): boolean {
  if (!shortcutStr) return false;
  const parts = shortcutStr.split("+").map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));

  const needCtrlOrMeta = mods.has("commandorcontrol");
  const needCtrl = mods.has("control") || needCtrlOrMeta;
  const needMeta = mods.has("meta") || needCtrlOrMeta;
  const needShift = mods.has("shift");
  const needAlt = mods.has("alt");

  const ctrlOk = needCtrlOrMeta
    ? e.ctrlKey || e.metaKey
    : needCtrl
      ? e.ctrlKey
      : !e.ctrlKey;
  const metaOk = needCtrlOrMeta
    ? true
    : needMeta
      ? e.metaKey
      : !e.metaKey;
  const shiftOk = needShift ? e.shiftKey : !e.shiftKey;
  const altOk = needAlt ? e.altKey : !e.altKey;

  const keyMatch =
    e.key.toLowerCase() === key || e.code.toLowerCase() === key;

  return ctrlOk && metaOk && shiftOk && altOk && keyMatch;
}

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Macintosh") || navigator.platform === "MacIntel");

/**
 * Format a Tauri shortcut string to a human-readable label.
 * Example: "CommandOrControl+Shift+R" → "Ctrl+Shift+R" (or "⌘+Shift+R" on macOS)
 */
export function formatShortcutLabel(shortcutStr: string): string {
  if (!shortcutStr) return "";
  return shortcutStr
    .replace(/CommandOrControl/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Meta/gi, "⌘")
    .replace(/\+/g, "+");
}
