import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { OpenAIProvider } from "../lib/ai/plugins/openai/OpenAIProvider";
import openaiPlugin from "../lib/ai/plugins/openai";

const mockInvoke = vi.mocked(invoke);

describe("OpenAIProvider", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("complete() calls openai_complete with correct args", async () => {
    mockInvoke.mockResolvedValue("enhanced result");
    const provider = new OpenAIProvider({
      api_key: "sk-test",
      base_url: "https://api.openai.com",
      selected_model: "gpt-4o",
    });

    const response = await provider.complete({
      systemPrompt: "You are helpful",
      userText: "Hello world",
    });

    expect(mockInvoke).toHaveBeenCalledWith("openai_complete", {
      baseUrl: "https://api.openai.com",
      apiKey: "sk-test",
      model: "gpt-4o",
      systemPrompt: "You are helpful",
      userText: "Hello world",
    });
    expect(response.text).toBe("enhanced result");
  });

  it("complete() uses request.model over config model", async () => {
    mockInvoke.mockResolvedValue("result");
    const provider = new OpenAIProvider({
      api_key: "sk-test",
      base_url: "https://api.openai.com",
      selected_model: "gpt-4o",
    });

    await provider.complete({
      systemPrompt: "sys",
      userText: "usr",
      model: "gpt-4o-mini",
    });

    expect(mockInvoke).toHaveBeenCalledWith("openai_complete", expect.objectContaining({
      model: "gpt-4o-mini",
    }));
  });

  it("complete() throws when no model selected", async () => {
    const provider = new OpenAIProvider({
      api_key: "sk-test",
      base_url: "https://api.openai.com",
      selected_model: "",
    });

    await expect(
      provider.complete({ systemPrompt: "sys", userText: "usr" }),
    ).rejects.toThrow("No model selected");
  });

  it("isReady() returns true when API key and base URL are set", () => {
    const provider = new OpenAIProvider({ api_key: "sk-test", base_url: "https://api.openai.com" });
    expect(provider.isReady()).toBe(true);
  });

  it("isReady() returns false when API key is empty", () => {
    const provider = new OpenAIProvider({ api_key: "", base_url: "https://api.openai.com" });
    expect(provider.isReady()).toBe(false);
  });

  it("isReady() returns false when base URL is empty", () => {
    const provider = new OpenAIProvider({ api_key: "sk-test", base_url: "" });
    expect(provider.isReady()).toBe(false);
  });

  it("isReady() returns false when both are missing", () => {
    const provider = new OpenAIProvider({});
    expect(provider.isReady()).toBe(false);
  });

  it("getIndicator() returns label and theme icons when ready", async () => {
    const provider = new OpenAIProvider({ api_key: "sk-test", base_url: "https://api.openai.com" });
    const indicator = await provider.getIndicator!();
    expect(indicator).toBeDefined();
    expect(indicator!.label).toBe("OpenAI");
    expect(indicator!.imageUrlDark).toContain("data:image/svg+xml");
    expect(indicator!.imageUrlLight).toContain("data:image/svg+xml");
  });

  it("getIndicator() returns null when no API key", async () => {
    const provider = new OpenAIProvider({ api_key: "", base_url: "https://api.openai.com" });
    const indicator = await provider.getIndicator!();
    expect(indicator).toBeNull();
  });

  it("getIndicator() returns null when no base URL", async () => {
    const provider = new OpenAIProvider({ api_key: "sk-test", base_url: "" });
    const indicator = await provider.getIndicator!();
    expect(indicator).toBeNull();
  });
});

describe("openaiPlugin", () => {
  it("has correct id and label", () => {
    expect(openaiPlugin.id).toBe("openai");
    expect(openaiPlugin.label).toBe("OpenAI");
  });

  it("defaultConfig has expected keys", () => {
    const config = openaiPlugin.defaultConfig();
    expect(config).toHaveProperty("api_key", "");
    expect(config).toHaveProperty("base_url", "");
    expect(config).toHaveProperty("selected_model", "");
  });

  it("canStart fails without API key", () => {
    const result = openaiPlugin.canStart({ api_key: "", base_url: "https://api.openai.com" });
    expect(result.ready).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("canStart fails without base URL", () => {
    const result = openaiPlugin.canStart({ api_key: "sk-test", base_url: "" });
    expect(result.ready).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("canStart succeeds with API key and base URL", () => {
    const result = openaiPlugin.canStart({ api_key: "sk-test", base_url: "https://api.openai.com" });
    expect(result.ready).toBe(true);
  });

  it("createProvider returns an OpenAIProvider", () => {
    const provider = openaiPlugin.createProvider({
      api_key: "sk-test",
      base_url: "https://api.openai.com",
      selected_model: "gpt-4o",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
    expect(typeof provider.isReady).toBe("function");
  });

  it("has streaming capability", () => {
    expect(openaiPlugin.capabilities.has("streaming")).toBe(true);
  });
});
