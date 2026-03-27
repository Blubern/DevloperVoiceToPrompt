import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ollamaComplete, ollamaListModels, ollamaCheckConnection } from "../lib/ollamaStore";

const mockInvoke = vi.mocked(invoke);

describe("ollamaStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("ollamaComplete", () => {
    it("calls ollama_complete with correct args (no api_key)", async () => {
      mockInvoke.mockResolvedValue("enhanced text");
      const result = await ollamaComplete(
        "http://localhost:11434",
        "llama3",
        "system prompt",
        "user text",
      );
      expect(mockInvoke).toHaveBeenCalledWith("ollama_complete", {
        baseUrl: "http://localhost:11434",
        model: "llama3",
        systemPrompt: "system prompt",
        userText: "user text",
      });
      expect(result).toBe("enhanced text");
    });
  });

  describe("ollamaListModels", () => {
    it("calls ollama_list_models with correct args", async () => {
      const models = [{ id: "llama3", name: "llama3" }];
      mockInvoke.mockResolvedValue(models);
      const result = await ollamaListModels("http://localhost:11434");
      expect(mockInvoke).toHaveBeenCalledWith("ollama_list_models", {
        baseUrl: "http://localhost:11434",
      });
      expect(result).toEqual(models);
    });
  });

  describe("ollamaCheckConnection", () => {
    it("calls ollama_check_connection with correct args", async () => {
      mockInvoke.mockResolvedValue(true);
      const result = await ollamaCheckConnection("http://localhost:11434");
      expect(mockInvoke).toHaveBeenCalledWith("ollama_check_connection", {
        baseUrl: "http://localhost:11434",
      });
      expect(result).toBe(true);
    });
  });
});
