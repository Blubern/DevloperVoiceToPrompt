import { load, type Store } from "@tauri-apps/plugin-store";
import { providerRegistry } from "./speech/plugins";

export interface ProviderUsage {
  today: number;
  thisWeek: number;
  last30Days: number;
}

/** Per-provider usage keyed by provider ID, plus a "total" rollup. */
export type UsageStats = Record<string, ProviderUsage> & { total: ProviderUsage };

let storePromise: Promise<Store> | null = null;
let migrationDone = false;
let writeQueue: Promise<void> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(() => {}, () => {});
  return result;
}

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("usage.json").catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
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

/** Migrate old untagged "daily" data into "daily_web" (best guess). Runs at most once per session. */
async function migrateIfNeeded(s: Store): Promise<void> {
  if (migrationDone) return;
  const old = await s.get<Record<string, number>>("daily");
  if (!old || Object.keys(old).length === 0) {
    migrationDone = true;
    return;
  }
  // Merge old data into daily_web
  const existing = (await s.get<Record<string, number>>("daily_web")) ?? {};
  for (const [k, v] of Object.entries(old)) {
    existing[k] = (existing[k] ?? 0) + v;
  }
  await s.set("daily_web", existing);
  await s.delete("daily");
  migrationDone = true;
}

/** Map provider ID to store key. Legacy: "os" → "daily_web", others → "daily_{id}". */
function providerStoreKey(provider: string): string {
  return provider === "os" ? "daily_web" : `daily_${provider}`;
}

/** All store keys for registered providers (+ legacy "daily_web"). */
function allProviderStoreKeys(): string[] {
  return providerRegistry.getIds().map(providerStoreKey);
}

export function recordUsage(seconds: number, provider: string): Promise<void> {
  if (seconds <= 0) return Promise.resolve();
  return serialized(async () => {
    const s = await getStore();
    const storeKey = providerStoreKey(provider);
    const key = todayKey();
    const raw = await s.get<Record<string, number>>(storeKey);
    const daily: Record<string, number> = raw ?? {};
    daily[key] = (daily[key] ?? 0) + seconds;
    await s.set(storeKey, daily);
    await s.save();
  });
}

function computeProviderUsage(daily: Record<string, number>): ProviderUsage {
  const now = new Date();
  const todayStr = todayKey();
  const monday = getMonday(now);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setHours(0, 0, 0, 0);
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

  const total: ProviderUsage = { today: 0, thisWeek: 0, last30Days: 0 };
  const result: Record<string, ProviderUsage> = {};

  for (const id of providerRegistry.getIds()) {
    const key = providerStoreKey(id);
    const raw = (await s.get<Record<string, number>>(key)) ?? {};
    const usage = computeProviderUsage(raw);
    // Use legacy key "web" for "os" to keep backward compat with UsageTab
    result[id === "os" ? "web" : id] = usage;
    total.today += usage.today;
    total.thisWeek += usage.thisWeek;
    total.last30Days += usage.last30Days;
  }

  return { ...result, total } as UsageStats;
}

export function resetUsage(): Promise<void> {
  return serialized(async () => {
    const s = await getStore();
    for (const key of allProviderStoreKeys()) {
      await s.set(key, {});
    }
    await s.delete("daily"); // clean up legacy
    await s.save();
  });
}

export function pruneOldEntries(): Promise<void> {
  return serialized(async () => {
    const s = await getStore();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    for (const storeKey of allProviderStoreKeys()) {
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
    await s.save();
  });
}

export function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}
