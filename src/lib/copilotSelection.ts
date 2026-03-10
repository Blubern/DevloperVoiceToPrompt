import type { CopilotModel } from "./copilotStore";

/**
 * Resolve the popup's selected Copilot model from persisted settings.
 * Only valid, currently available model ids should be auto-selected.
 */
export function resolveSavedCopilotModel(
  savedModelId: string,
  models: CopilotModel[],
): string {
  if (!savedModelId) {
    return "";
  }

  return models.some((model) => model.id === savedModelId) ? savedModelId : "";
}