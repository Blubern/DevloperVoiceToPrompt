import { describe, it, expect, beforeEach } from "vitest";
import {
  addTemplate,
  getTemplates,
  updateTemplate,
  deleteTemplate,
} from "../lib/templateStore";

beforeEach(async () => {
  // Clear templates by deleting all existing ones
  const all = await getTemplates();
  for (const t of all) {
    await deleteTemplate(t.id);
  }
});

describe("templateStore CRUD", () => {
  it("creates a template with UUID, timestamps, and trimmed text", async () => {
    const t = await addTemplate("  My Template  ", "  template body  ");
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("My Template");
    expect(t.text).toBe("template body");
    expect(t.createdAt).toBeTruthy();
    expect(t.updatedAt).toBeTruthy();
  });

  it("retrieves created templates", async () => {
    await addTemplate("Template A", "body a");
    await addTemplate("Template B", "body b");
    const all = await getTemplates();
    expect(all).toHaveLength(2);
  });

  it("rejects empty name or text", async () => {
    await expect(addTemplate("", "body")).rejects.toThrow("Name and text are required");
    await expect(addTemplate("name", "")).rejects.toThrow("Name and text are required");
    await expect(addTemplate("  ", "  ")).rejects.toThrow("Name and text are required");
  });

  it("updates a template by ID", async () => {
    const t = await addTemplate("Original", "original body");
    await updateTemplate(t.id, "Updated", "updated body");
    const all = await getTemplates();
    const updated = all.find((x) => x.id === t.id);
    expect(updated?.name).toBe("Updated");
    expect(updated?.text).toBe("updated body");
  });

  it("updates does not throw for non-existent ID", async () => {
    // updateTemplate silently returns when ID is not found
    await expect(
      updateTemplate("non-existent-id", "name", "text"),
    ).resolves.toBeUndefined();
  });

  it("deletes a template by ID", async () => {
    const t = await addTemplate("To Delete", "body");
    await deleteTemplate(t.id);
    const all = await getTemplates();
    expect(all.find((x) => x.id === t.id)).toBeUndefined();
  });

  it("normalizes Windows line endings", async () => {
    const t = await addTemplate("CRLF Test", "line1\r\nline2\r\nline3");
    expect(t.text).toBe("line1\nline2\nline3");
  });
});
