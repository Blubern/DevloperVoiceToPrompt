import { load, type Store } from "@tauri-apps/plugin-store";

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("templates.json");
  }
  return store;
}

export async function getTemplates(): Promise<PromptTemplate[]> {
  const s = await getStore();
  const raw = await s.get<PromptTemplate[]>("templates");
  return raw ?? [];
}

export async function addTemplate(
  name: string,
  text: string
): Promise<PromptTemplate> {
  const trimmedName = name.trim();
  const trimmedText = text.trim();
  if (!trimmedName || !trimmedText) throw new Error("Name and text are required");

  const s = await getStore();
  const entries = await getTemplates();
  const now = new Date().toISOString();
  const template: PromptTemplate = {
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

export async function updateTemplate(
  id: string,
  name: string,
  text: string
): Promise<void> {
  const s = await getStore();
  const entries = await getTemplates();
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

export async function deleteTemplate(id: string): Promise<void> {
  const s = await getStore();
  const entries = await getTemplates();
  const filtered = entries.filter((t) => t.id !== id);
  await s.set("templates", filtered);
  await s.save();
}
