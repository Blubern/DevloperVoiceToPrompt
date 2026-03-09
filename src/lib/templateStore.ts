import { load, type Store } from "@tauri-apps/plugin-store";

export interface PromptTemplate {
  id: string;
  name: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

let storePromise: Promise<Store> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(() => {}, () => {});
  return result;
}

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load("templates.json").catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

export async function getTemplates(): Promise<PromptTemplate[]> {
  const s = await getStore();
  const raw = await s.get<PromptTemplate[]>("templates");
  return (raw ?? []).map((t) => ({
    ...t,
    text: t.text.replace(/\r\n/g, "\n"),
  }));
}

export function addTemplate(
  name: string,
  text: string
): Promise<PromptTemplate> {
  return serialized(async () => {
    const trimmedName = name.trim();
    const trimmedText = text.trim().replace(/\r\n/g, "\n");
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
  });
}

export function updateTemplate(
  id: string,
  name: string,
  text: string
): Promise<void> {
  return serialized(async () => {
    const s = await getStore();
    const entries = await getTemplates();
    const idx = entries.findIndex((t) => t.id === id);
    if (idx === -1) return;
    entries[idx] = {
      ...entries[idx],
      name: name.trim(),
      text: text.trim().replace(/\r\n/g, "\n"),
      updatedAt: new Date().toISOString(),
    };
    await s.set("templates", entries);
    await s.save();
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return serialized(async () => {
    const s = await getStore();
    const entries = await getTemplates();
    const filtered = entries.filter((t) => t.id !== id);
    await s.set("templates", filtered);
    await s.save();
  });
}
