import { describe, it, expect, beforeEach } from "vitest";
import {
  getEnhancerTemplates,
  addEnhancerTemplate,
  updateEnhancerTemplate,
  deleteEnhancerTemplate,
  resetEnhancerTemplates,
  DEFAULT_ENHANCER_TEMPLATES,
} from "../lib/enhancerTemplateStore";

beforeEach(async () => {
  // Reset to defaults before each test to get a clean state
  await resetEnhancerTemplates();
});

describe("enhancerTemplateStore defaults", () => {
  it("seeds default templates on first load", async () => {
    const templates = await getEnhancerTemplates();
    expect(templates).toHaveLength(DEFAULT_ENHANCER_TEMPLATES.length);
    expect(templates[0].name).toBe(DEFAULT_ENHANCER_TEMPLATES[0].name);
    expect(templates[1].name).toBe(DEFAULT_ENHANCER_TEMPLATES[1].name);
  });

  it("default templates have IDs and timestamps", async () => {
    const templates = await getEnhancerTemplates();
    for (const t of templates) {
      expect(t.id).toBeTruthy();
      expect(t.createdAt).toBeTruthy();
      expect(t.updatedAt).toBeTruthy();
    }
  });

  it("default templates contain expected text content", async () => {
    const templates = await getEnhancerTemplates();
    expect(templates[0].text).toBe(DEFAULT_ENHANCER_TEMPLATES[0].text);
    expect(templates[1].text).toBe(DEFAULT_ENHANCER_TEMPLATES[1].text);
  });
});

describe("enhancerTemplateStore CRUD", () => {
  it("adds a new template with trimmed name and text", async () => {
    const t = await addEnhancerTemplate("  Custom Template  ", "  custom body  ");
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("Custom Template");
    expect(t.text).toBe("custom body");
    expect(t.createdAt).toBeTruthy();
    expect(t.updatedAt).toBeTruthy();

    const all = await getEnhancerTemplates();
    expect(all).toHaveLength(DEFAULT_ENHANCER_TEMPLATES.length + 1);
  });

  it("rejects empty name or text", async () => {
    await expect(addEnhancerTemplate("", "body")).rejects.toThrow("Name and text are required");
    await expect(addEnhancerTemplate("name", "")).rejects.toThrow("Name and text are required");
    await expect(addEnhancerTemplate("  ", "  ")).rejects.toThrow("Name and text are required");
  });

  it("updates an existing template by ID", async () => {
    const added = await addEnhancerTemplate("Original", "original body");
    await updateEnhancerTemplate(added.id, "Updated Name", "updated body");
    const all = await getEnhancerTemplates();
    const updated = all.find((t) => t.id === added.id);
    expect(updated?.name).toBe("Updated Name");
    expect(updated?.text).toBe("updated body");
  });

  it("update is a no-op for non-existent ID", async () => {
    await expect(
      updateEnhancerTemplate("non-existent-id", "name", "text"),
    ).resolves.toBeUndefined();
  });

  it("update trims name and text", async () => {
    const added = await addEnhancerTemplate("Test", "body");
    await updateEnhancerTemplate(added.id, "  Trimmed  ", "  trimmed body  ");
    const all = await getEnhancerTemplates();
    const updated = all.find((t) => t.id === added.id);
    expect(updated?.name).toBe("Trimmed");
    expect(updated?.text).toBe("trimmed body");
  });

  it("deletes a template by ID", async () => {
    const added = await addEnhancerTemplate("To Delete", "body");
    const before = await getEnhancerTemplates();
    await deleteEnhancerTemplate(added.id);
    const after = await getEnhancerTemplates();
    expect(after.length).toBe(before.length - 1);
    expect(after.find((t) => t.id === added.id)).toBeUndefined();
  });

  it("delete is a no-op for non-existent ID", async () => {
    const before = await getEnhancerTemplates();
    await deleteEnhancerTemplate("non-existent-id");
    const after = await getEnhancerTemplates();
    expect(after.length).toBe(before.length);
  });
});

describe("enhancerTemplateStore reset", () => {
  it("restores defaults after custom templates were added and defaults deleted", async () => {
    // Delete all defaults
    const before = await getEnhancerTemplates();
    for (const t of before) {
      await deleteEnhancerTemplate(t.id);
    }
    // Add a custom one
    await addEnhancerTemplate("Custom", "text");

    // Reset
    const restored = await resetEnhancerTemplates();
    expect(restored).toHaveLength(DEFAULT_ENHANCER_TEMPLATES.length);
    expect(restored[0].name).toBe(DEFAULT_ENHANCER_TEMPLATES[0].name);
    expect(restored[1].name).toBe(DEFAULT_ENHANCER_TEMPLATES[1].name);

    // Verify custom template is gone
    const all = await getEnhancerTemplates();
    expect(all.find((t) => t.name === "Custom")).toBeUndefined();
  });
});
