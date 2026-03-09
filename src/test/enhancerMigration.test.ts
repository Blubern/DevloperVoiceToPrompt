/**
 * Tests for enhancerTemplateStore migration comparison logic.
 *
 * Bug: Object identity comparison (template !== raw[index]) after .map()
 * with spread always returned true, causing unnecessary store writes and
 * fresh updatedAt timestamps on every load.
 *
 * Fix: Compare actual field values (template.text !== raw[index].text).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { load } from "@tauri-apps/plugin-store";

const mockedLoad = vi.mocked(load);

describe("enhancerTemplateStore migration does not spuriously rewrite", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedLoad.mockClear();
  });

  it("does not rewrite store when templates already have current text", async () => {
    const { DEFAULT_ENHANCER_TEMPLATES } = await import("../lib/enhancerTemplateStore");

    const existingTemplates = DEFAULT_ENHANCER_TEMPLATES.map((t) => ({
      id: "test-id-" + t.name,
      name: t.name,
      text: t.text, // Already current text — no migration needed
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));

    const fakeStore = {
      get: vi.fn((key: string) => {
        if (key === "templates") return Promise.resolve(existingTemplates);
        return Promise.resolve(undefined);
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValue(fakeStore as any);

    // Re-import to get fresh module with our mock
    const { getEnhancerTemplates } = await import("../lib/enhancerTemplateStore");

    const result = await getEnhancerTemplates();

    // Templates should be returned as-is without rewriting
    expect(result).toHaveLength(existingTemplates.length);
    expect(result[0].updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result[1].updatedAt).toBe("2026-01-01T00:00:00.000Z");

    // store.set should NOT have been called — no migration was needed
    expect(fakeStore.set).not.toHaveBeenCalled();
    expect(fakeStore.save).not.toHaveBeenCalled();
  });

  it("rewrites store when templates have legacy text", async () => {
    // Use a dynamic re-import to read the legacy text constants
    // We can't import private constants, so we inline the legacy text
    const legacyDeveloperText = `Take the raw dictated text and transform it into a clear, well-structured developer prompt. Fix grammar, remove filler words, and organize the intent into actionable instructions. Preserve all technical terms, code references, and specific requirements. Use concise professional language suitable for AI coding assistants. Leave the Language like it is no translations.`;

    const existingTemplates = [
      {
        id: "test-dev",
        name: "Developer Prompt Optimizer",
        text: legacyDeveloperText,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "test-cleanup",
        name: "Some Other Template",
        text: "custom text",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const fakeStore = {
      get: vi.fn((key: string) => {
        if (key === "templates") return Promise.resolve(existingTemplates);
        return Promise.resolve(undefined);
      }),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    mockedLoad.mockResolvedValue(fakeStore as any);

    const { getEnhancerTemplates, DEFAULT_ENHANCER_TEMPLATES } = await import("../lib/enhancerTemplateStore");

    const result = await getEnhancerTemplates();

    // The developer template should have been migrated to new text
    const devTemplate = result.find((t) => t.name === "Developer Prompt Optimizer");
    expect(devTemplate).toBeDefined();
    expect(devTemplate!.text).toBe(DEFAULT_ENHANCER_TEMPLATES[0].text);
    expect(devTemplate!.text).not.toBe(legacyDeveloperText);

    // store.set should have been called to persist the migration
    expect(fakeStore.set).toHaveBeenCalledWith("templates", expect.any(Array));
    expect(fakeStore.save).toHaveBeenCalled();
  });
});
