import { load, type Store } from "@tauri-apps/plugin-store";

export interface EnhancerTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("enhancer-templates.json");
  }
  return store;
}

export const DEFAULT_ENHANCER_TEMPLATES = [
  {
    name: "Developer Prompt Optimizer",
    text: `Take the raw dictated text and transform it into a clear, well-structured developer prompt. Fix grammar, remove filler words, and organize the intent into actionable instructions. Preserve all technical terms, code references, and specific requirements. Use concise professional language suitable for AI coding assistants.`,
  },
  {
    name: "Dictation Cleanup",
    text: `Clean up the raw dictated text without changing its meaning. Fix grammar, punctuation, and sentence structure. Remove filler words, false starts, and repetitions. Keep the original tone, intent, and all technical terms exactly as intended. Do not rephrase, summarize, or add anything new.`,
  },
];

export async function getEnhancerTemplates(): Promise<EnhancerTemplate[]> {
  const s = await getStore();
  const raw = await s.get<EnhancerTemplate[]>("templates");
  if (raw && raw.length > 0) return raw;

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
