import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_ENHANCER_TEMPLATES } from "./enhancerDefaults";
import { migrateIfNeeded } from "./enhancerMigration";

// Re-export for backward compatibility
export { DEFAULT_ENHANCER_TEMPLATES } from "./enhancerDefaults";

export interface EnhancerTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

let storePromise: Promise<Store> | null = null;
let migrationDone = false;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("enhancer-templates.json").catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

export async function getEnhancerTemplates(): Promise<EnhancerTemplate[]> {
  const s = await getStore();
  const raw = await s.get<EnhancerTemplate[]>("templates");
  if (raw && raw.length > 0) {
    // Only run migration if we haven't already this session
    if (!migrationDone) {
      migrationDone = true;
      return migrateIfNeeded(s, raw);
    }

    return raw;
  }

  // Seed default templates on first use
  const now = new Date().toISOString();
  const defaults: EnhancerTemplate[] = DEFAULT_ENHANCER_TEMPLATES.map((t) => ({
    id: crypto.randomUUID(),
    name: t.name,
    text: t.text,
    createdAt: now,
    updatedAt: now,
  }));
  await s.set("templates", defaults);
  await s.save();
  return defaults;
}

export async function addEnhancerTemplate(
  name: string,
  text: string
): Promise<EnhancerTemplate> {
  const trimmedName = name.trim();
  const trimmedText = text.trim();
  if (!trimmedName || !trimmedText) throw new Error("Name and text are required");

  const s = await getStore();
  const entries = await getEnhancerTemplates();
  const now = new Date().toISOString();
  const template: EnhancerTemplate = {
    id: crypto.randomUUID(),
    name: trimmedName,
    text: trimmedText,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(template);
  await s.set("templates", entries);
  await s.save();
  return template;
}

export async function updateEnhancerTemplate(
  id: string,
  name: string,
  text: string
): Promise<void> {
  const s = await getStore();
  const entries = await getEnhancerTemplates();
  const idx = entries.findIndex((t) => t.id === id);
  if (idx === -1) return;
  entries[idx] = {
    ...entries[idx],
    name: name.trim(),
    text: text.trim(),
    updatedAt: new Date().toISOString(),
  };
  await s.set("templates", entries);
  await s.save();
}

export async function deleteEnhancerTemplate(id: string): Promise<void> {
  const s = await getStore();
  const entries = await getEnhancerTemplates();
  const filtered = entries.filter((t) => t.id !== id);
  await s.set("templates", filtered);
  await s.save();
}

export async function resetEnhancerTemplates(): Promise<EnhancerTemplate[]> {
  const s = await getStore();
  const now = new Date().toISOString();
  const defaults: EnhancerTemplate[] = DEFAULT_ENHANCER_TEMPLATES.map((t) => ({
    id: crypto.randomUUID(),
    name: t.name,
    text: t.text,
    createdAt: now,
    updatedAt: now,
  }));
  await s.set("templates", defaults);
  await s.save();
  return defaults;
}
