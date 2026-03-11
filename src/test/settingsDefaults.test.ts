import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settingsStore";

/**
 * These tests verify that the frontend DEFAULT_SETTINGS match the Rust backend
 * defaults defined in src-tauri/src/settings.rs. If a field is added to one side
 * but not the other, or defaults diverge, these tests catch it early.
 *
 * Whenever you change a default in settings.rs, update DEFAULT_SETTINGS in
 * settingsStore.ts and verify these tests still pass.
 */
describe("DEFAULT_SETTINGS alignment with Rust backend", () => {
  it("has correct speech_provider default", () => {
    expect(DEFAULT_SETTINGS.speech_provider).toBe("os");
  });

  it("has correct os_language default", () => {
    expect(DEFAULT_SETTINGS.os_language).toBe("en-US");
  });

  it("has correct theme default", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark");
  });

  it("has correct shortcut default", () => {
    expect(DEFAULT_SETTINGS.shortcut).toBe("CommandOrControl+Alt+V");
  });

  it("has correct always_on_top default", () => {
    expect(DEFAULT_SETTINGS.always_on_top).toBe(false);
  });

  it("has correct show_in_dock default (must match Rust)", () => {
    // Rust backend: show_in_dock: false (settings.rs Default impl)
    // If this fails, the defaults have diverged — fix whichever side changed.
    expect(DEFAULT_SETTINGS.show_in_dock).toBe(false);
  });

  it("has correct mcp_enabled default", () => {
    expect(DEFAULT_SETTINGS.mcp_enabled).toBe(false);
  });

  it("has correct mcp_port default", () => {
    expect(DEFAULT_SETTINGS.mcp_port).toBe(31337);
  });

  it("has correct mcp_timeout_seconds default", () => {
    expect(DEFAULT_SETTINGS.mcp_timeout_seconds).toBe(300);
  });

  it("has correct copilot_enabled default", () => {
    expect(DEFAULT_SETTINGS.copilot_enabled).toBe(false);
  });

  it("has correct copilot_delete_sessions default", () => {
    expect(DEFAULT_SETTINGS.copilot_delete_sessions).toBe(true);
  });

  it("has correct history_enabled default", () => {
    expect(DEFAULT_SETTINGS.history_enabled).toBe(true);
  });

  it("has correct history_max_entries default", () => {
    expect(DEFAULT_SETTINGS.history_max_entries).toBe(50);
  });

  it("has correct silence_timeout_seconds default", () => {
    expect(DEFAULT_SETTINGS.silence_timeout_seconds).toBe(30);
  });

  it("has correct max_recording_seconds default", () => {
    expect(DEFAULT_SETTINGS.max_recording_seconds).toBe(180);
  });

  it("has correct open_popup_on_start default", () => {
    expect(DEFAULT_SETTINGS.open_popup_on_start).toBe(true);
  });

  it("has correct autostart_enabled default", () => {
    expect(DEFAULT_SETTINGS.autostart_enabled).toBe(false);
  });

  it("has correct popup_font default", () => {
    expect(DEFAULT_SETTINGS.popup_font).toBe("mono");
  });

  it("has correct whisper_model default", () => {
    expect(DEFAULT_SETTINGS.whisper_model).toBe("base");
  });

  it("has correct whisper_decode_interval default", () => {
    expect(DEFAULT_SETTINGS.whisper_decode_interval).toBe(1);
  });
});

describe("DEFAULT_SETTINGS completeness", () => {
  it("has all expected keys defined", () => {
    // This list must match the AppSettings interface fields.
    // If you add a field to AppSettings, add it here too.
    const expectedKeys = [
      "speech_provider",
      "os_language",
      "os_auto_restart",
      "os_max_restarts",
      "azure_speech_key",
      "azure_region",
      "whisper_model",
      "whisper_language",
      "whisper_chunk_seconds",
      "whisper_decode_interval",
      "whisper_context_overlap",
      "whisper_cli_version",
      "whisper_cli_variant",
      "whisper_use_gpu",
      "languages",
      "shortcut",
      "microphone_device_id",
      "theme",
      "phrase_list",
      "always_on_top",
      "auto_punctuation",
      "auto_start_recording",
      "silence_timeout_seconds",
      "history_enabled",
      "history_max_entries",
      "popup_copy_shortcut",
      "popup_voice_shortcut",
      "provider_switch_shortcut",
      "max_recording_enabled",
      "max_recording_seconds",
      "autostart_enabled",
      "copilot_enabled",
      "copilot_selected_model",
      "copilot_selected_enhancer",
      "copilot_delete_sessions",
      "prompt_enhancer_shortcut",
      "popup_font",
      "open_popup_on_start",
      "mcp_enabled",
      "mcp_port",
      "mcp_timeout_seconds",
      "show_in_dock",
      "speech_tracing",
      "speech_trace_max_entries",
    ];

    const actualKeys = Object.keys(DEFAULT_SETTINGS).sort();
    expect(actualKeys).toEqual(expectedKeys.sort());
  });

  it("has no undefined values", () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(value, `DEFAULT_SETTINGS.${key} should not be undefined`).not.toBeUndefined();
    }
  });
});
