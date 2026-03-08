import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { tauriInvoke } from "../lib/tauriInvoke";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("tauriInvoke", () => {
  it("returns the value on success", async () => {
    mockInvoke.mockResolvedValueOnce({ hello: "world" });
    const result = await tauriInvoke<{ hello: string }>("test_cmd");
    expect(result).toEqual({ hello: "world" });
    expect(mockInvoke).toHaveBeenCalledWith("test_cmd", undefined);
  });

  it("passes args to invoke", async () => {
    mockInvoke.mockResolvedValueOnce("ok");
    await tauriInvoke("save_settings", { settings: { theme: "dark" } });
    expect(mockInvoke).toHaveBeenCalledWith("save_settings", { settings: { theme: "dark" } });
  });

  it("wraps Error rejection in a formatted message", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("permission denied"));
    await expect(tauriInvoke("fail_cmd")).rejects.toThrow(
      'Tauri command "fail_cmd" failed: permission denied',
    );
  });

  it("wraps string rejection in a formatted message", async () => {
    mockInvoke.mockRejectedValueOnce("some string error");
    await expect(tauriInvoke("fail_cmd")).rejects.toThrow(
      'Tauri command "fail_cmd" failed: some string error',
    );
  });

  it("wraps non-string/non-Error rejection", async () => {
    mockInvoke.mockRejectedValueOnce(42);
    await expect(tauriInvoke("fail_cmd")).rejects.toThrow(
      'Tauri command "fail_cmd" failed: 42',
    );
  });

  it("throws an instance of Error", async () => {
    mockInvoke.mockRejectedValueOnce("oops");
    try {
      await tauriInvoke("fail_cmd");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
