import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  copilotAuthStatus,
  copilotListModels,
  copilotEnhance,
} from "../lib/copilotStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("copilotStore", () => {
  it("copilotAuthStatus calls invoke and returns auth info", async () => {
    const authData = {
      authenticated: true,
      login: "testuser",
      host: "github.com",
      status_message: null,
    };
    mockInvoke.mockResolvedValueOnce(authData);
    const result = await copilotAuthStatus();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_auth_status", undefined);
    expect(result).toEqual(authData);
  });

  it("copilotListModels calls invoke and returns model list", async () => {
    const models = [
      { id: "gpt-4o", name: "GPT-4o", is_premium: true, multiplier: 1.0 },
      { id: "gpt-3.5", name: "GPT-3.5", is_premium: false, multiplier: 0.5 },
    ];
    mockInvoke.mockResolvedValueOnce(models);
    const result = await copilotListModels();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_list_models", undefined);
    expect(result).toEqual(models);
    expect(result).toHaveLength(2);
  });

  it("copilotEnhance passes model, system prompt, and user text", async () => {
    mockInvoke.mockResolvedValueOnce("enhanced text result");
    const result = await copilotEnhance("gpt-4o", "system prompt", "user text");
    expect(mockInvoke).toHaveBeenCalledWith("copilot_enhance", {
      modelId: "gpt-4o",
      systemPrompt: "system prompt",
      userText: "user text",
    });
    expect(result).toBe("enhanced text result");
  });

  it("copilotAuthStatus returns unauthenticated state", async () => {
    const unauth = {
      authenticated: false,
      login: null,
      host: null,
      status_message: "Not signed in",
    };
    mockInvoke.mockResolvedValueOnce(unauth);
    const result = await copilotAuthStatus();
    expect(result.authenticated).toBe(false);
    expect(result.login).toBeNull();
    expect(result.status_message).toBe("Not signed in");
  });

  it("copilotListModels returns empty array when no models available", async () => {
    mockInvoke.mockResolvedValueOnce([]);
    const result = await copilotListModels();
    expect(result).toEqual([]);
  });

  it("wraps invoke errors in Error objects via tauriInvoke", async () => {
    mockInvoke.mockRejectedValueOnce("auth check failed");
    await expect(copilotAuthStatus()).rejects.toThrow('Tauri command "copilot_auth_status" failed: auth check failed');
  });

  it("wraps Error-type rejections via tauriInvoke", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("connection refused"));
    await expect(copilotListModels()).rejects.toThrow('Tauri command "copilot_list_models" failed: connection refused');
  });
});
