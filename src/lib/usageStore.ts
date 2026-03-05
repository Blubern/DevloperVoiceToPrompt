import { load, type Store } from "@tauri-apps/plugin-store";

export interface ProviderUsage {
  today: number;
  thisWeek: number;
  last30Days: number;
}

export interface UsageStats {
  web: ProviderUsage;
  azure: ProviderUsage;
  total: ProviderUsage;
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

/** Migrate old untagged "daily" data into "daily_web" (best guess). */
async function migrateIfNeeded(s: Store): Promise<void> {
  const old = await s.get<Record<string, number>>("daily");
  if (!old || Object.keys(old).length === 0) return;
  // Merge old data into daily_web
  const existing = (await s.get<Record<string, number>>("daily_web")) ?? {};
  for (const [k, v] of Object.entries(old)) {
    existing[k] = (existing[k] ?? 0) + v;
  }
  await s.set("daily_web", existing);
  await s.delete("daily");
}

export async function recordUsage(seconds: number, provider: "os" | "azure"): Promise<void> {
  if (seconds <= 0) return;
  const s = await getStore();
  const storeKey = provider === "os" ? "daily_web" : "daily_azure";
  const key = todayKey();
  const raw = await s.get<Record<string, number>>(storeKey);
  const daily: Record<string, number> = raw ?? {};
  daily[key] = (daily[key] ?? 0) + seconds;
  await s.set(storeKey, daily);
}

function computeProviderUsage(daily: Record<string, number>): ProviderUsage {
  const now = new Date();
  const todayStr = todayKey();
  const monday = getMonday(now);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let today = 0;
  let thisWeek = 0;
  let last30Days = 0;

  for (const [dateStr, secs] of Object.entries(daily)) {
    const d = new Date(dateStr + "T00:00:00");
    if (dateStr === todayStr) today = secs;
    if (d >= monday) thisWeek += secs;
    if (d >= thirtyDaysAgo) last30Days += secs;
  }

  return { today, thisWeek, last30Days };
}

export async function getUsageStats(): Promise<UsageStats> {
  const s = await getStore();
  await migrateIfNeeded(s);

  const rawWeb = (await s.get<Record<string, number>>("daily_web")) ?? {};
  const rawAzure = (await s.get<Record<string, number>>("daily_azure")) ?? {};

  const web = computeProviderUsage(rawWeb);
  const azure = computeProviderUsage(rawAzure);
  const total: ProviderUsage = {
    today: web.today + azure.today,
    thisWeek: web.thisWeek + azure.thisWeek,
    last30Days: web.last30Days + azure.last30Days,
  };

  return { web, azure, total };
}

export async function resetUsage(): Promise<void> {
  const s = await getStore();
  await s.set("daily_web", {});
  await s.set("daily_azure", {});
  await s.delete("daily"); // clean up legacy
}

export async function pruneOldEntries(): Promise<void> {
  const s = await getStore();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  for (const storeKey of ["daily_web", "daily_azure"] as const) {
    const raw = await s.get<Record<string, number>>(storeKey);
    if (!raw) continue;
    const pruned: Record<string, number> = {};
    for (const [dateStr, secs] of Object.entries(raw)) {
      if (new Date(dateStr + "T00:00:00") >= cutoff) {
        pruned[dateStr] = secs;
      }
    }
    await s.set(storeKey, pruned);
  }
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
