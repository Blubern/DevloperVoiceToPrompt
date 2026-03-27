import { describe, it, expect, beforeEach } from "vitest";
import type { AIProviderPlugin } from "../lib/ai/registry";

// We test with a fresh registry instance to avoid polluting the singleton.
// The actual class is not exported, so we re-implement a minimal version
// that mirrors the production registry's public API.

function createTestRegistry() {
  const plugins = new Map<string, AIProviderPlugin>();
  const order: string[] = [];

  return {
    register(plugin: AIProviderPlugin): void {
      if (plugins.has(plugin.id)) {
        throw new Error(`AI provider "${plugin.id}" is already registered.`);
      }
      plugins.set(plugin.id, plugin);
      order.push(plugin.id);
    },
    get(id: string): AIProviderPlugin | undefined {
      return plugins.get(id);
    },
    getAll(): AIProviderPlugin[] {
      return order.map((id) => plugins.get(id)!);
    },
    getIds(): string[] {
      return [...order];
    },
    getLabel(id: string): string {
      return plugins.get(id)?.label ?? id;
    },
    get size(): number {
      return plugins.size;
    },
  };
}

function makeDummyPlugin(id: string, label: string): AIProviderPlugin {
  return {
    id,
    label,
    capabilities: new Set(),
    defaultConfig: () => ({ key: "value" }),
    canStart: () => ({ ready: true }),
    createProvider: () => ({
      complete: async () => ({ text: "" }),
      isReady: () => true,
    }),
    SettingsComponent: null as any,
  };
}

describe("AIProviderRegistry", () => {
  let registry: ReturnType<typeof createTestRegistry>;

  beforeEach(() => {
    registry = createTestRegistry();
  });

  it("starts empty", () => {
    expect(registry.size).toBe(0);
    expect(registry.getIds()).toEqual([]);
    expect(registry.getAll()).toEqual([]);
  });

  it("registers a plugin and retrieves it", () => {
    const plugin = makeDummyPlugin("test", "Test Provider");
    registry.register(plugin);
    expect(registry.size).toBe(1);
    expect(registry.get("test")).toBe(plugin);
  });

  it("returns undefined for unknown plugin ID", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("preserves registration order", () => {
    registry.register(makeDummyPlugin("b", "B"));
    registry.register(makeDummyPlugin("a", "A"));
    registry.register(makeDummyPlugin("c", "C"));
    expect(registry.getIds()).toEqual(["b", "a", "c"]);
  });

  it("getAll returns plugins in order", () => {
    const p1 = makeDummyPlugin("first", "First");
    const p2 = makeDummyPlugin("second", "Second");
    registry.register(p1);
    registry.register(p2);
    expect(registry.getAll()).toEqual([p1, p2]);
  });

  it("getLabel returns the label for a registered plugin", () => {
    registry.register(makeDummyPlugin("copilot", "GitHub Copilot"));
    expect(registry.getLabel("copilot")).toBe("GitHub Copilot");
  });

  it("getLabel falls back to the ID for unknown plugins", () => {
    expect(registry.getLabel("unknown")).toBe("unknown");
  });

  it("throws on duplicate registration", () => {
    registry.register(makeDummyPlugin("dup", "Duplicate"));
    expect(() => registry.register(makeDummyPlugin("dup", "Another")))
      .toThrowError('AI provider "dup" is already registered.');
  });

  it("provides correct default config from plugin", () => {
    const plugin = makeDummyPlugin("cfg", "Config Test");
    registry.register(plugin);
    expect(registry.get("cfg")!.defaultConfig()).toEqual({ key: "value" });
  });

  it("canStart returns ready for dummy plugin", () => {
    const plugin = makeDummyPlugin("ready", "Ready");
    registry.register(plugin);
    expect(registry.get("ready")!.canStart({})).toEqual({ ready: true });
  });
});
