import { load, type Store } from "@tauri-apps/plugin-store";

export interface HistoryEntry {
  id: string;
  timestamp: string; // ISO 8601
  text: string;
  input_reason?: string;
}

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("history.json").catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

export async function addHistoryEntry(
  text: string,
  maxEntries: number,
  inputReason?: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const s = await getStore();
  const raw = await s.get<HistoryEntry[]>("entries");
  const entries: HistoryEntry[] = raw ?? [];
  const entry: HistoryEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), text: trimmed };
  if (inputReason) entry.input_reason = inputReason;
  entries.unshift(entry);
  if (entries.length > maxEntries) {
    entries.length = maxEntries;
  }
  await s.set("entries", entries);
  await s.save();
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const s = await getStore();
  const raw = await s.get<HistoryEntry[]>("entries");
  return raw ?? [];
}

export async function clearHistory(): Promise<void> {
  const s = await getStore();
  await s.set("entries", []);
  await s.save();
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const s = await getStore();
  const raw = await s.get<HistoryEntry[]>("entries");
  const entries = (raw ?? []).filter((e) => e.id !== id);
  await s.set("entries", entries);
  await s.save();
}

export async function pruneHistory(maxEntries: number): Promise<void> {
  const s = await getStore();
  const raw = await s.get<HistoryEntry[]>("entries");
  if (!raw || raw.length <= maxEntries) return;
  await s.set("entries", raw.slice(0, maxEntries));
  await s.save();
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
