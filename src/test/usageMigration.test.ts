/**
 * Tests for usageStore migration flag timing.
 *
 * Bug: migrationDone was set to true BEFORE the migration completed.
 * If migration threw, it would never retry.
 *
 * Fix: migrationDone = true is now set AFTER successful completion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { load } from "@tauri-apps/plugin-store";

const mockedLoad = vi.mocked(load);

describe("usageStore migration retry on failure", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("retries migration after a transient failure", async () => {
    let migrationAttempts = 0;
    let shouldFail = true;

    const fakeStore = {
      get: vi.fn((key: string) => {
        if (key === "daily") {
          migrationAttempts++;
          if (shouldFail) {
            return Promise.reject(new Error("transient read error"));
          }
          // No old data to migrate on retry
          return Promise.resolve(undefined);
        }
        if (key === "daily_web") return Promise.resolve({ "2026-03-08": 60 });
        if (key === "daily_azure") return Promise.resolve(undefined);
        if (key === "daily_whisper") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValue(fakeStore as any);

    const { getUsageStats } = await import("../lib/usageStore");

    // First call — migration fails
    await expect(getUsageStats()).rejects.toThrow("transient read error");
    expect(migrationAttempts).toBe(1);

    // Disable the failure — next migration attempt will succeed
    shouldFail = false;

    // Second call — migration retries because the flag was not set
    const stats = await getUsageStats();
    expect(migrationAttempts).toBe(2); // migration was retried
    expect(stats.web.today).toBe(60);
  });

  it("does not retry migration after success", async () => {
    let migrationAttempts = 0;

    const fakeStore = {
      get: vi.fn((key: string) => {
        if (key === "daily") {
          migrationAttempts++;
          return Promise.resolve(undefined); // no old data
        }
        if (key === "daily_web") return Promise.resolve({ "2026-03-08": 60 });
        if (key === "daily_azure") return Promise.resolve(undefined);
        if (key === "daily_whisper") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValue(fakeStore as any);

    const { getUsageStats } = await import("../lib/usageStore");

    await getUsageStats();
    expect(migrationAttempts).toBe(1);

    await getUsageStats();
    // Migration should NOT have run again
    expect(migrationAttempts).toBe(1);
  });
});
