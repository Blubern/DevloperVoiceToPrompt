import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGUAGES, AZURE_REGIONS } from "../lib/speechConstants";
import { DEFAULT_ENHANCER_TEMPLATES } from "../lib/enhancerDefaults";

// ---------------------------------------------------------------------------
// SUPPORTED_LANGUAGES — prevent duplicate codes and malformed entries
// ---------------------------------------------------------------------------

describe("SUPPORTED_LANGUAGES", () => {
  it("has no duplicate language codes", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every entry has non-empty code and label", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.code.length).toBeGreaterThan(0);
      expect(lang.label.length).toBeGreaterThan(0);
    }
  });

  it("codes follow BCP 47 format (xx-XX)", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.code).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("includes English (US) as first entry", () => {
    expect(SUPPORTED_LANGUAGES[0].code).toBe("en-US");
  });

  it("has a reasonable number of entries", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// AZURE_REGIONS — prevent duplicate values and invalid entries
// ---------------------------------------------------------------------------

describe("AZURE_REGIONS", () => {
  it("has no duplicate region values", () => {
    const values = AZURE_REGIONS.map((r) => r.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every entry has non-empty value and label", () => {
    for (const region of AZURE_REGIONS) {
      expect(region.value.length).toBeGreaterThan(0);
      expect(region.label.length).toBeGreaterThan(0);
    }
  });

  it("region values are lowercase alphanumeric (valid Azure region IDs)", () => {
    for (const region of AZURE_REGIONS) {
      expect(region.value).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("includes eastus (default region)", () => {
    expect(AZURE_REGIONS.some((r) => r.value === "eastus")).toBe(true);
  });

  it("includes westus", () => {
    expect(AZURE_REGIONS.some((r) => r.value === "westus")).toBe(true);
  });

  it("includes westeurope", () => {
    expect(AZURE_REGIONS.some((r) => r.value === "westeurope")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ENHANCER_TEMPLATES — validate structure and content
// ---------------------------------------------------------------------------

describe("DEFAULT_ENHANCER_TEMPLATES", () => {
  it("has exactly 2 default templates", () => {
    expect(DEFAULT_ENHANCER_TEMPLATES).toHaveLength(2);
  });

  it("every template has non-empty name and text", () => {
    for (const t of DEFAULT_ENHANCER_TEMPLATES) {
      expect(t.name.trim().length).toBeGreaterThan(0);
      expect(t.text.trim().length).toBeGreaterThan(10);
    }
  });

  it("includes Developer Prompt Optimizer", () => {
    expect(DEFAULT_ENHANCER_TEMPLATES.some((t) => t.name.includes("Prompt Optimizer"))).toBe(true);
  });

  it("includes Dictation Cleanup", () => {
    expect(DEFAULT_ENHANCER_TEMPLATES.some((t) => t.name.includes("Dictation Cleanup"))).toBe(true);
  });

  it("template names are unique", () => {
    const names = DEFAULT_ENHANCER_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
