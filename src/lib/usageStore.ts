import { load, type Store } from "@tauri-apps/plugin-store";

export interface UsageStats {
  today: number;
  thisWeek: number;
  calendarMonth: number;
  last30Days: number;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("usage.json");
  }
  return store;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // "2026-03-05"
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday=0 offset
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function recordUsage(seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const s = await getStore();
  const key = todayKey();
  const raw = await s.get<Record<string, number>>("daily");
  const daily: Record<string, number> = raw ?? {};
  daily[key] = (daily[key] ?? 0) + seconds;
  await s.set("daily", daily);
}

export async function getUsageStats(): Promise<UsageStats> {
  const s = await getStore();
  const raw = await s.get<Record<string, number>>("daily");
  const daily: Record<string, number> = raw ?? {};

  const now = new Date();
  const todayStr = todayKey();
  const monday = getMonday(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let today = 0;
  let thisWeek = 0;
  let calendarMonth = 0;
  let last30Days = 0;

  for (const [dateStr, secs] of Object.entries(daily)) {
    const d = new Date(dateStr + "T00:00:00");
    if (dateStr === todayStr) today = secs;
    if (d >= monday) thisWeek += secs;
    if (d >= monthStart) calendarMonth += secs;
    if (d >= thirtyDaysAgo) last30Days += secs;
  }

  return { today, thisWeek, calendarMonth, last30Days };
}

export async function resetUsage(): Promise<void> {
  const s = await getStore();
  await s.set("daily", {});
}

export async function pruneOldEntries(): Promise<void> {
  const s = await getStore();
  const raw = await s.get<Record<string, number>>("daily");
  if (!raw) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const pruned: Record<string, number> = {};
  for (const [dateStr, secs] of Object.entries(raw)) {
    if (new Date(dateStr + "T00:00:00") >= cutoff) {
      pruned[dateStr] = secs;
    }
  }
  await s.set("daily", pruned);
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
