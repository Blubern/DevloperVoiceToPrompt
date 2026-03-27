import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

// Must mock before import
vi.mock("@tauri-apps/api/core");

import { CopilotAIProvider } from "../lib/ai/plugins/copilot/CopilotAIProvider";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("CopilotAIProvider", () => {
  it("complete() calls copilotEnhance with the configured model", async () => {
    mockInvoke.mockResolvedValueOnce("enhanced output");

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const result = await provider.complete({
      systemPrompt: "You are a helpful assistant",
      userText: "Hello world",
    });

    expect(mockInvoke).toHaveBeenCalledWith("copilot_enhance", {
      modelId: "gpt-4o",
      systemPrompt: "You are a helpful assistant",
      userText: "Hello world",
    });
    expect(result).toEqual({ text: "enhanced output" });
  });

  it("complete() uses request.model over config model", async () => {
    mockInvoke.mockResolvedValueOnce("result");

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    await provider.complete({
      systemPrompt: "sys",
      userText: "user",
      model: "claude-sonnet",
    });

    expect(mockInvoke).toHaveBeenCalledWith("copilot_enhance", {
      modelId: "claude-sonnet",
      systemPrompt: "sys",
      userText: "user",
    });
  });

  it("complete() throws when no model is configured or provided", async () => {
    const provider = new CopilotAIProvider({});
    await expect(
      provider.complete({ systemPrompt: "sys", userText: "user" })
    ).rejects.toThrow("No model selected");
  });

  it("isReady() returns true when authenticated", async () => {
    mockInvoke.mockResolvedValueOnce({
      authenticated: true,
      login: "testuser",
      host: "github.com",
      status_message: null,
    });

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const ready = await provider.isReady();
    expect(ready).toBe(true);
  });

  it("isReady() returns false when not authenticated", async () => {
    mockInvoke.mockResolvedValueOnce({
      authenticated: false,
      login: null,
      host: null,
      status_message: "Not signed in",
    });

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const ready = await provider.isReady();
    expect(ready).toBe(false);
  });

  it("isReady() returns false when auth check throws", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("bridge not running"));

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const ready = await provider.isReady();
    expect(ready).toBe(false);
  });

  it("dispose() is a no-op and does not throw", () => {
    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    expect(() => provider.dispose()).not.toThrow();
  });

  it("getIndicator() returns label and SVG icon when authenticated", async () => {
    mockInvoke.mockResolvedValueOnce({
      authenticated: true,
      login: "octocat",
      host: "github.com",
      status_message: null,
    });

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const indicator = await provider.getIndicator();
    expect(indicator).toBeDefined();
    expect(indicator!.label).toBe("octocat");
    expect(indicator!.imageUrlDark).toContain("data:image/svg+xml");
    expect(indicator!.imageUrlLight).toContain("data:image/svg+xml");
  });

  it("getIndicator() returns null when not authenticated", async () => {
    mockInvoke.mockResolvedValueOnce({
      authenticated: false,
      login: null,
      host: null,
      status_message: "Not signed in",
    });

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const indicator = await provider.getIndicator();
    expect(indicator).toBeNull();
  });

  it("getIndicator() returns null when auth check throws", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("bridge error"));

    const provider = new CopilotAIProvider({ selected_model: "gpt-4o" });
    const indicator = await provider.getIndicator();
    expect(indicator).toBeNull();
  });
});
