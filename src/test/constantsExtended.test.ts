import { describe, it, expect } from "vitest";
import {
  FONT_OPTIONS,
  FONT_FAMILIES,
  EVENT_SETTINGS_UPDATED,
  EVENT_TEMPLATES_UPDATED,
  EVENT_ENHANCER_TEMPLATES_UPDATED,
  EVENT_CHECK_FIRST_RUN,
  EVENT_WHISPER_DOWNLOAD_PROGRESS,
  EVENT_MCP_VOICE_REQUEST,
  WHISPER_SILENCE_RMS_THRESHOLD,
  WHISPER_DEFAULT_DECODE_INTERVAL,
  WHISPER_MIN_DECODE_INTERVAL,
  WHISPER_MAX_DECODE_INTERVAL,
  WHISPER_DEFAULT_CONTEXT_OVERLAP,
  WHISPER_STABILITY_COUNT,
  DEFAULT_SILENCE_TIMEOUT_SECONDS,
  DEFAULT_MAX_RECORDING_SECONDS,
  ABOUT_LIBRARIES,
  APP_GITHUB_URL,
  ENHANCE_SYSTEM_PROMPT_WRAPPER,
} from "../lib/constants";

describe("FONT_OPTIONS / FONT_FAMILIES", () => {
  it("has at least one font option", () => {
    expect(FONT_OPTIONS.length).toBeGreaterThan(0);
  });

  it("every font option has value, label, and family", () => {
    for (const opt of FONT_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.family).toBeTruthy();
    }
  });

  it("FONT_FAMILIES maps every FONT_OPTIONS value to its family", () => {
    for (const opt of FONT_OPTIONS) {
      expect(FONT_FAMILIES[opt.value]).toBe(opt.family);
    }
  });

  it("FONT_FAMILIES has same count as FONT_OPTIONS", () => {
    expect(Object.keys(FONT_FAMILIES)).toHaveLength(FONT_OPTIONS.length);
  });

  it("contains the default 'mono' option", () => {
    expect(FONT_FAMILIES["mono"]).toBeDefined();
  });
});

describe("event constants", () => {
  it("all event constants are non-empty strings", () => {
    const events = [
      EVENT_SETTINGS_UPDATED,
      EVENT_TEMPLATES_UPDATED,
      EVENT_ENHANCER_TEMPLATES_UPDATED,
      EVENT_CHECK_FIRST_RUN,
      EVENT_WHISPER_DOWNLOAD_PROGRESS,
      EVENT_MCP_VOICE_REQUEST,
    ];
    for (const evt of events) {
      expect(typeof evt).toBe("string");
      expect(evt.length).toBeGreaterThan(0);
    }
  });

  it("event constants are unique", () => {
    const events = [
      EVENT_SETTINGS_UPDATED,
      EVENT_TEMPLATES_UPDATED,
      EVENT_ENHANCER_TEMPLATES_UPDATED,
      EVENT_CHECK_FIRST_RUN,
      EVENT_WHISPER_DOWNLOAD_PROGRESS,
      EVENT_MCP_VOICE_REQUEST,
    ];
    const unique = new Set(events);
    expect(unique.size).toBe(events.length);
  });
});

describe("Whisper tuning constants", () => {
  it("silence RMS threshold is a positive number below 1", () => {
    expect(WHISPER_SILENCE_RMS_THRESHOLD).toBeGreaterThan(0);
    expect(WHISPER_SILENCE_RMS_THRESHOLD).toBeLessThan(1);
  });

  it("decode interval bounds are consistent", () => {
    expect(WHISPER_MIN_DECODE_INTERVAL).toBeLessThan(WHISPER_MAX_DECODE_INTERVAL);
    expect(WHISPER_DEFAULT_DECODE_INTERVAL).toBeGreaterThanOrEqual(WHISPER_MIN_DECODE_INTERVAL);
    expect(WHISPER_DEFAULT_DECODE_INTERVAL).toBeLessThanOrEqual(WHISPER_MAX_DECODE_INTERVAL);
  });

  it("context overlap default is positive", () => {
    expect(WHISPER_DEFAULT_CONTEXT_OVERLAP).toBeGreaterThan(0);
  });

  it("stability count is a positive integer", () => {
    expect(WHISPER_STABILITY_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(WHISPER_STABILITY_COUNT)).toBe(true);
  });
});

describe("timer defaults", () => {
  it("silence timeout is positive", () => {
    expect(DEFAULT_SILENCE_TIMEOUT_SECONDS).toBeGreaterThan(0);
  });

  it("max recording is greater than silence timeout", () => {
    expect(DEFAULT_MAX_RECORDING_SECONDS).toBeGreaterThan(DEFAULT_SILENCE_TIMEOUT_SECONDS);
  });
});

describe("about metadata", () => {
  it("APP_GITHUB_URL is a valid URL", () => {
    expect(APP_GITHUB_URL).toMatch(/^https:\/\//);
  });

  it("ABOUT_LIBRARIES has entries with required fields", () => {
    expect(ABOUT_LIBRARIES.length).toBeGreaterThan(0);
    for (const lib of ABOUT_LIBRARIES) {
      expect(lib.name).toBeTruthy();
      expect(lib.description).toBeTruthy();
      expect(lib.category).toBeTruthy();
    }
  });

  it("ENHANCE_SYSTEM_PROMPT_WRAPPER is a non-empty string", () => {
    expect(ENHANCE_SYSTEM_PROMPT_WRAPPER.length).toBeGreaterThan(0);
  });
});
