import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openaiComplete, openaiListModels, openaiCheckConnection } from "../lib/openaiStore";

const mockInvoke = vi.mocked(invoke);

describe("openaiStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("openaiComplete", () => {
    it("calls openai_complete with correct args", async () => {
      mockInvoke.mockResolvedValue("enhanced text");
      const result = await openaiComplete(
        "https://api.openai.com",
        "sk-test",
        "gpt-4o",
        "system prompt",
        "user text",
      );
      expect(mockInvoke).toHaveBeenCalledWith("openai_complete", {
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
        model: "gpt-4o",
        systemPrompt: "system prompt",
        userText: "user text",
      });
      expect(result).toBe("enhanced text");
    });
  });

  describe("openaiListModels", () => {
    it("calls openai_list_models with correct args", async () => {
      const models = [{ id: "gpt-4o", name: "gpt-4o" }];
      mockInvoke.mockResolvedValue(models);
      const result = await openaiListModels("https://api.openai.com", "sk-test");
      expect(mockInvoke).toHaveBeenCalledWith("openai_list_models", {
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
      });
      expect(result).toEqual(models);
    });
  });

  describe("openaiCheckConnection", () => {
    it("calls openai_check_connection with correct args", async () => {
      mockInvoke.mockResolvedValue(true);
      const result = await openaiCheckConnection("https://api.openai.com", "sk-test");
      expect(mockInvoke).toHaveBeenCalledWith("openai_check_connection", {
        baseUrl: "https://api.openai.com",
        apiKey: "sk-test",
      });
      expect(result).toBe(true);
    });
  });
});
