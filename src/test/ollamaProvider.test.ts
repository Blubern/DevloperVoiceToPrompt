import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { OllamaProvider } from "../lib/ai/plugins/ollama/OllamaProvider";
import ollamaPlugin from "../lib/ai/plugins/ollama";

const mockInvoke = vi.mocked(invoke);

describe("OllamaProvider", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("complete() calls ollama_complete with correct args (no api_key)", async () => {
    mockInvoke.mockResolvedValue("enhanced result");
    const provider = new OllamaProvider({
      server_url: "http://localhost:11434",
      selected_model: "llama3",
    });

    const response = await provider.complete({
      systemPrompt: "You are helpful",
      userText: "Hello world",
    });

    expect(mockInvoke).toHaveBeenCalledWith("ollama_complete", {
      baseUrl: "http://localhost:11434",
      model: "llama3",
      systemPrompt: "You are helpful",
      userText: "Hello world",
    });
    expect(response.text).toBe("enhanced result");
  });

  it("complete() uses request.model over config model", async () => {
    mockInvoke.mockResolvedValue("result");
    const provider = new OllamaProvider({
      server_url: "http://localhost:11434",
      selected_model: "llama3",
    });

    await provider.complete({
      systemPrompt: "sys",
      userText: "usr",
      model: "mistral",
    });

    expect(mockInvoke).toHaveBeenCalledWith("ollama_complete", expect.objectContaining({
      model: "mistral",
    }));
  });

  it("complete() throws when no model selected", async () => {
    const provider = new OllamaProvider({
      server_url: "http://localhost:11434",
      selected_model: "",
    });

    await expect(
      provider.complete({ systemPrompt: "sys", userText: "usr" }),
    ).rejects.toThrow("No model selected");
  });

  it("isReady() returns true when model is set", () => {
    const provider = new OllamaProvider({ selected_model: "llama3" });
    expect(provider.isReady()).toBe(true);
  });

  it("isReady() returns false when model is empty", () => {
    const provider = new OllamaProvider({ selected_model: "" });
    expect(provider.isReady()).toBe(false);
  });

  it("isReady() returns false when model is missing", () => {
    const provider = new OllamaProvider({});
    expect(provider.isReady()).toBe(false);
  });

  it("getIndicator() returns label and theme icons when model set", async () => {
    const provider = new OllamaProvider({ selected_model: "llama3" });
    const indicator = await provider.getIndicator!();
    expect(indicator).toBeDefined();
    expect(indicator!.label).toBe("Ollama");
    expect(indicator!.imageUrlDark).toContain("data:image/svg+xml");
    expect(indicator!.imageUrlLight).toContain("data:image/svg+xml");
  });

  it("getIndicator() returns null when no model", async () => {
    const provider = new OllamaProvider({ selected_model: "" });
    const indicator = await provider.getIndicator!();
    expect(indicator).toBeNull();
  });
});

describe("ollamaPlugin", () => {
  it("has correct id and label", () => {
    expect(ollamaPlugin.id).toBe("ollama");
    expect(ollamaPlugin.label).toBe("Ollama");
  });

  it("defaultConfig has expected keys", () => {
    const config = ollamaPlugin.defaultConfig();
    expect(config).toHaveProperty("server_url", "");
    expect(config).toHaveProperty("selected_model", "");
  });

  it("canStart fails without server URL", () => {
    const result = ollamaPlugin.canStart({ server_url: "" });
    expect(result.ready).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("canStart succeeds with server URL", () => {
    const result = ollamaPlugin.canStart({ server_url: "http://localhost:11434" });
    expect(result.ready).toBe(true);
  });

  it("createProvider returns an OllamaProvider", () => {
    const provider = ollamaPlugin.createProvider({
      server_url: "http://localhost:11434",
      selected_model: "llama3",
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
    expect(typeof provider.isReady).toBe("function");
  });

  it("has local-model capability", () => {
    expect(ollamaPlugin.capabilities.has("local-model")).toBe(true);
  });
});
