// ---------------------------------------------------------------------------
// Enhancer template migration logic (v1 → v2)
// ---------------------------------------------------------------------------

import type { Store } from "@tauri-apps/plugin-store";
import type { EnhancerTemplate } from "./enhancerTemplateStore";
import {
  DEVELOPER_PROMPT_OPTIMIZER_NAME,
  LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
  DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
  DICTATION_CLEANUP_NAME,
  LEGACY_DICTATION_CLEANUP_TEXT,
  DEFAULT_DICTATION_CLEANUP_TEXT,
} from "./enhancerDefaults";

const CURRENT_TEMPLATE_VERSION = 2;

/**
 * Migrate templates from v1 to v2 if needed.
 * Returns the (possibly updated) template list.
 */
export async function migrateIfNeeded(
  s: Store,
  raw: EnhancerTemplate[],
): Promise<EnhancerTemplate[]> {
  const version = await s.get<number>("template_version");
  if (version && version >= CURRENT_TEMPLATE_VERSION) {
    return raw;
  }

  const migrated = raw.map((template) => {
    if (
      template.name === DEVELOPER_PROMPT_OPTIMIZER_NAME &&
      template.text === LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT
    ) {
      return {
        ...template,
        text: DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
        updatedAt: new Date().toISOString(),
      };
    }

    if (
      template.name === DICTATION_CLEANUP_NAME &&
      template.text === LEGACY_DICTATION_CLEANUP_TEXT
    ) {
      return {
        ...template,
        text: DEFAULT_DICTATION_CLEANUP_TEXT,
        updatedAt: new Date().toISOString(),
      };
    }

    return template;
  });

  const changed = migrated.some((template, index) => template.text !== raw[index].text);
  if (changed) {
    await s.set("templates", migrated);
  }
  await s.set("template_version", CURRENT_TEMPLATE_VERSION);
  await s.save();

  return changed ? migrated : raw;
}
