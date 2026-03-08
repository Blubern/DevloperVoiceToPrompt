import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  copilotInit,
  copilotAuthStatus,
  copilotListModels,
  copilotStop,
  copilotEnhance,
} from "../lib/copilotStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("copilotStore", () => {
  it("copilotInit calls invoke with correct command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await copilotInit();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_init");
  });

  it("copilotAuthStatus calls invoke and returns auth info", async () => {
    const authData = {
      authenticated: true,
      login: "testuser",
      host: "github.com",
      status_message: null,
    };
    mockInvoke.mockResolvedValueOnce(authData);
    const result = await copilotAuthStatus();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_auth_status");
    expect(result).toEqual(authData);
  });

  it("copilotListModels calls invoke and returns model list", async () => {
    const models = [
      { id: "gpt-4o", name: "GPT-4o", is_premium: true, multiplier: 1.0 },
      { id: "gpt-3.5", name: "GPT-3.5", is_premium: false, multiplier: 0.5 },
    ];
    mockInvoke.mockResolvedValueOnce(models);
    const result = await copilotListModels();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_list_models");
    expect(result).toEqual(models);
    expect(result).toHaveLength(2);
  });

  it("copilotStop calls invoke with correct command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await copilotStop();
    expect(mockInvoke).toHaveBeenCalledWith("copilot_stop");
  });

  it("copilotEnhance passes all params including deleteSession=true by default", async () => {
    mockInvoke.mockResolvedValueOnce("enhanced text result");
    const result = await copilotEnhance("gpt-4o", "system prompt", "user text");
    expect(mockInvoke).toHaveBeenCalledWith("copilot_enhance", {
      modelId: "gpt-4o",
      systemPrompt: "system prompt",
      userText: "user text",
      deleteSession: true,
    });
    expect(result).toBe("enhanced text result");
  });

  it("copilotEnhance passes deleteSession=false when specified", async () => {
    mockInvoke.mockResolvedValueOnce("result");
    await copilotEnhance("gpt-4o", "sys", "user", false);
    expect(mockInvoke).toHaveBeenCalledWith("copilot_enhance", {
      modelId: "gpt-4o",
      systemPrompt: "sys",
      userText: "user",
      deleteSession: false,
    });
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
});
