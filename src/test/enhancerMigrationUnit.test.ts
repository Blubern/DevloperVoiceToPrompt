import { describe, it, expect, vi } from "vitest";
import { migrateIfNeeded } from "../lib/enhancerMigration";
import type { EnhancerTemplate } from "../lib/enhancerTemplateStore";
import {
  LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
  LEGACY_DICTATION_CLEANUP_TEXT,
  DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT,
  DEFAULT_DICTATION_CLEANUP_TEXT,
} from "../lib/enhancerDefaults";

function makeStore(data: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...data };
  return {
    get: vi.fn((key: string) => Promise.resolve(store[key])),
    set: vi.fn((key: string, val: unknown) => {
      store[key] = val;
      return Promise.resolve();
    }),
    save: vi.fn(() => Promise.resolve()),
  };
}

function makeTemplate(name: string, text: string, id = "test-id"): EnhancerTemplate {
  return { id, name, text, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" };
}

// ---------------------------------------------------------------------------
// migrateIfNeeded — template v1→v2 migration
// ---------------------------------------------------------------------------

describe("migrateIfNeeded", () => {
  it("skips migration when version is already current", async () => {
    const s = makeStore({ template_version: 2 });
    const templates = [makeTemplate("Custom", "custom text")];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result).toBe(templates); // same reference, no mutation
    expect(s.set).not.toHaveBeenCalledWith("templates", expect.anything());
  });

  it("migrates legacy Developer Prompt Optimizer text", async () => {
    const s = makeStore({});
    const templates = [makeTemplate("Developer Prompt Optimizer", LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT)];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result[0].text).toBe(DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT);
    expect(result[0].updatedAt).not.toBe("2024-01-01T00:00:00Z"); // timestamp updated
    expect(s.set).toHaveBeenCalledWith("templates", expect.any(Array));
    expect(s.set).toHaveBeenCalledWith("template_version", 2);
    expect(s.save).toHaveBeenCalled();
  });

  it("migrates legacy Dictation Cleanup text", async () => {
    const s = makeStore({});
    const templates = [makeTemplate("Dictation Cleanup", LEGACY_DICTATION_CLEANUP_TEXT)];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result[0].text).toBe(DEFAULT_DICTATION_CLEANUP_TEXT);
    expect(result[0].updatedAt).not.toBe("2024-01-01T00:00:00Z");
  });

  it("migrates both legacy templates at once", async () => {
    const s = makeStore({});
    const templates = [
      makeTemplate("Developer Prompt Optimizer", LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT, "id-1"),
      makeTemplate("Dictation Cleanup", LEGACY_DICTATION_CLEANUP_TEXT, "id-2"),
    ];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result[0].text).toBe(DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT);
    expect(result[1].text).toBe(DEFAULT_DICTATION_CLEANUP_TEXT);
  });

  it("does not modify custom templates during migration", async () => {
    const s = makeStore({});
    const templates = [
      makeTemplate("Developer Prompt Optimizer", LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT, "id-1"),
      makeTemplate("My Custom Template", "my custom prompt text", "id-2"),
    ];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result[0].text).toBe(DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT);
    expect(result[1].text).toBe("my custom prompt text");
    expect(result[1].updatedAt).toBe("2024-01-01T00:00:00Z"); // unchanged
  });

  it("sets version marker without rewriting templates when nothing changed", async () => {
    const s = makeStore({});
    const templates = [makeTemplate("Custom Only", "nothing to migrate here")];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result).toBe(templates); // same reference — no unnecessary rewrite
    // Should NOT call set("templates", ...) since nothing changed
    const templateSetCalls = (s.set as any).mock.calls.filter(
      (c: [string, unknown]) => c[0] === "templates",
    );
    expect(templateSetCalls).toHaveLength(0);
    // But DOES set version marker
    expect(s.set).toHaveBeenCalledWith("template_version", 2);
    expect(s.save).toHaveBeenCalled();
  });

  it("does not re-migrate already updated text", async () => {
    const s = makeStore({});
    // Template already has the NEW text (was migrated before)
    const templates = [makeTemplate("Developer Prompt Optimizer", DEFAULT_DEVELOPER_PROMPT_OPTIMIZER_TEXT)];
    const result = await migrateIfNeeded(s as any, templates);
    // Should not rewrite since text already matches current default
    expect(result).toBe(templates);
    const templateSetCalls = (s.set as any).mock.calls.filter(
      (c: [string, unknown]) => c[0] === "templates",
    );
    expect(templateSetCalls).toHaveLength(0);
  });

  it("preserves template IDs during migration", async () => {
    const s = makeStore({});
    const templates = [makeTemplate("Developer Prompt Optimizer", LEGACY_DEVELOPER_PROMPT_OPTIMIZER_TEXT, "keep-this-id")];
    const result = await migrateIfNeeded(s as any, templates);
    expect(result[0].id).toBe("keep-this-id");
    expect(result[0].createdAt).toBe("2024-01-01T00:00:00Z"); // createdAt preserved
  });
});
