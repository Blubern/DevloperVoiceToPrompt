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

export async function getEnhancerTemplates(): Promise<EnhancerTemplate[]> {
  const s = await getStore();
  const raw = await s.get<EnhancerTemplate[]>("templates");
  return raw ?? [];
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
