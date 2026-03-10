import { describe, expect, it } from "vitest";

import { resolveSavedCopilotModel } from "../lib/copilotSelection";

const copilotModels = [
  { id: "gpt-4o", name: "GPT-4o", is_premium: false, multiplier: 1 },
  { id: "claude-3.7", name: "Claude 3.7", is_premium: true, multiplier: 2 },
];

describe("resolveSavedCopilotModel", () => {
  it("returns the saved model id when it is available", () => {
    expect(resolveSavedCopilotModel("gpt-4o", copilotModels)).toBe("gpt-4o");
  });

  it("returns an empty string when no saved model is configured", () => {
    expect(resolveSavedCopilotModel("", copilotModels)).toBe("");
  });

  it("returns an empty string when the saved model is not available", () => {
    expect(resolveSavedCopilotModel("missing-model", copilotModels)).toBe("");
  });

  it("returns an empty string when the model list is empty", () => {
    expect(resolveSavedCopilotModel("gpt-4o", [])).toBe("");
  });
});