import { vi } from "vitest";

// Mock Tauri's invoke API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock Tauri's event API
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Mock Tauri's window API
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    label: "main",
    show: vi.fn(),
    hide: vi.fn(),
    setFocus: vi.fn(),
    innerSize: vi.fn(() => Promise.resolve({ width: 600, height: 450 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 100, y: 100 })),
    scaleFactor: vi.fn(() => Promise.resolve(1)),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    isVisible: vi.fn(() => Promise.resolve(true)),
  })),
}));

// Mock Tauri store plugin
vi.mock("@tauri-apps/plugin-store", () => {
  const store: Record<string, unknown> = {};
  return {
    load: vi.fn(() =>
      Promise.resolve({
        get: vi.fn((key: string) => Promise.resolve(store[key])),
        set: vi.fn((key: string, val: unknown) => {
          store[key] = val;
          return Promise.resolve();
        }),
        save: vi.fn(() => Promise.resolve()),
        delete: vi.fn((key: string) => {
          delete store[key];
          return Promise.resolve();
        }),
      }),
    ),
  };
});

// Mock clipboard
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));
