import { describe, it, expect } from "vitest";
import {
  cleanText,
  stripOverlap,
  checkStability,
  buildSessionBuffer,
  computeCompaction,
  computeRms,
  uint8ToBase64,
} from "../lib/speech/whisperHelpers";
import { WHISPER_STABILITY_COUNT } from "../lib/constants";

// ---------------------------------------------------------------------------
// cleanText
// ---------------------------------------------------------------------------

describe("cleanText", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanText("  hello   world  ")).toBe("hello world");
  });

  it("normalizes tabs and newlines", () => {
    expect(cleanText("hello\t\nworld")).toBe("hello world");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanText("   ")).toBe("");
  });

  it("preserves single words", () => {
    expect(cleanText("hello")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// stripOverlap — the core reconciliation algorithm
// ---------------------------------------------------------------------------

describe("stripOverlap", () => {
  it("returns full text when nothing committed yet", () => {
    expect(stripOverlap([], "hello world")).toBe("hello world");
  });

  it("strips full committed phrase from start", () => {
    expect(stripOverlap(["hello", "world"], "hello world goodbye")).toBe("goodbye");
  });

  it("strips partial suffix match (last word only)", () => {
    // committed=["the","quick","brown"], text starts with "brown fox"
    // "the quick brown" doesn't match "brown fox jumps", try "quick brown" → no,
    // try "brown" → matches! strip 1 word
    expect(stripOverlap(["the", "quick", "brown"], "brown fox jumps")).toBe("fox jumps");
  });

  it("returns empty when all text matches committed", () => {
    expect(stripOverlap(["hello", "world"], "hello world")).toBe("");
  });

  it("is case-insensitive", () => {
    expect(stripOverlap(["Hello", "World"], "hello world new text")).toBe("new text");
  });

  it("handles committed longer than transcription via partial suffix", () => {
    // committed=["a","b","c","d"], text="c d e" → suffix "c d" matches start
    expect(stripOverlap(["a", "b", "c", "d"], "c d e")).toBe("e");
  });

  it("returns full text when no overlap found", () => {
    expect(stripOverlap(["completely", "different"], "hello world")).toBe("hello world");
  });

  it("handles empty transcription", () => {
    expect(stripOverlap(["hello"], "")).toBe("");
  });

  it("handles whitespace-only transcription", () => {
    expect(stripOverlap(["hello"], "   ")).toBe("");
  });

  it("handles multi-word overlap at the start", () => {
    expect(
      stripOverlap(["I", "said", "hello", "world"], "I said hello world how are you"),
    ).toBe("how are you");
  });

  it("prefers longest suffix match (full phrase first)", () => {
    // committed=["one","two","three"], text="one two three four"
    // Full match "one two three" → strip 3 words
    expect(stripOverlap(["one", "two", "three"], "one two three four")).toBe("four");
  });

  it("collapses extra whitespace in transcription before matching", () => {
    expect(stripOverlap(["hello"], "  hello   world  ")).toBe("world");
  });

  it("handles single-word committed matching single-word prefix", () => {
    expect(stripOverlap(["hello"], "hello world")).toBe("world");
  });

  it("does not match in the middle of the transcription", () => {
    // committed=["world"], text="hello world goodbye" → "world" matches prefix of split words at index 1
    // But stripOverlap only matches at the START of words, so "world" at position[0] doesn't match "hello"
    // Actually: words=["hello","world","goodbye"], committed=["world"]
    // startIdx=0: suffix=["world"], match words[0]="hello" vs "world" → no match
    // So bestMatchLen=0, returns full text
    expect(stripOverlap(["world"], "hello world goodbye")).toBe("hello world goodbye");
  });
});

// ---------------------------------------------------------------------------
// checkStability — decides when interim text becomes final
// ---------------------------------------------------------------------------

describe("checkStability", () => {
  it("increments hits when text repeats", () => {
    const result = checkStability("hello", "hello", 1, WHISPER_STABILITY_COUNT);
    expect(result.newStabilityHits).toBe(2);
    expect(result.newLastInterim).toBe("hello");
  });

  it("resets hits when text changes", () => {
    const result = checkStability("world", "hello", 3, WHISPER_STABILITY_COUNT);
    expect(result.newStabilityHits).toBe(1);
    expect(result.newLastInterim).toBe("world");
  });

  it("commits when threshold reached", () => {
    const result = checkStability("stable", "stable", WHISPER_STABILITY_COUNT - 1, WHISPER_STABILITY_COUNT);
    expect(result.shouldCommit).toBe(true);
  });

  it("does not commit below threshold", () => {
    const result = checkStability("changing", "something", 1, WHISPER_STABILITY_COUNT);
    expect(result.shouldCommit).toBe(false);
  });

  it("does not commit on first occurrence", () => {
    const result = checkStability("new text", "", 0, WHISPER_STABILITY_COUNT);
    expect(result.shouldCommit).toBe(false);
    expect(result.newStabilityHits).toBe(1);
  });

  it("commits exactly at the threshold boundary", () => {
    // threshold=2: first occurrence → hits=1, second → hits=2 (commit)
    const r1 = checkStability("text", "", 0, 2);
    expect(r1.shouldCommit).toBe(false);
    expect(r1.newStabilityHits).toBe(1);

    const r2 = checkStability("text", r1.newLastInterim, r1.newStabilityHits, 2);
    expect(r2.shouldCommit).toBe(true);
    expect(r2.newStabilityHits).toBe(2);
  });

  it("resets counter when text alternates", () => {
    const r1 = checkStability("aaa", "", 0, 3);
    const r2 = checkStability("bbb", r1.newLastInterim, r1.newStabilityHits, 3);
    const r3 = checkStability("aaa", r2.newLastInterim, r2.newStabilityHits, 3);
    expect(r3.newStabilityHits).toBe(1); // reset because text changed
    expect(r3.shouldCommit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSessionBuffer — audio chunk concatenation
// ---------------------------------------------------------------------------

describe("buildSessionBuffer", () => {
  it("returns empty array for no chunks", () => {
    const result = buildSessionBuffer([], 0);
    expect(result.length).toBe(0);
  });

  it("returns the single chunk directly (no copy)", () => {
    const chunk = new Float32Array([1, 2, 3]);
    const result = buildSessionBuffer([chunk], 3);
    expect(result).toBe(chunk); // same reference
  });

  it("concatenates multiple chunks in order", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4, 5]);
    const result = buildSessionBuffer([a, b], 5);
    expect(Array.from(result.subarray(0, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("reuses existing buffer when large enough", () => {
    const existing = new Float32Array(10);
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3]);
    const result = buildSessionBuffer([a, b], 3, existing);
    expect(result).toBe(existing);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
    expect(result[2]).toBe(3);
  });

  it("allocates new buffer when existing is too small", () => {
    const existing = new Float32Array(2);
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5]);
    const result = buildSessionBuffer([a, b], 5, existing);
    expect(result).not.toBe(existing);
    expect(result.length).toBe(5);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// computeCompaction — memory management for long sessions
// ---------------------------------------------------------------------------

describe("computeCompaction", () => {
  it("drops nothing when committedSamples is 0", () => {
    const chunks = [new Float32Array(100), new Float32Array(100)];
    const { dropCount, dropSamples } = computeCompaction(chunks, 0, 50);
    expect(dropCount).toBe(0);
    expect(dropSamples).toBe(0);
  });

  it("drops nothing when overlap covers everything", () => {
    const chunks = [new Float32Array(100)];
    // committed=100, overlap=200 → keepFrom = max(0, 100-200) = 0
    const { dropCount, dropSamples } = computeCompaction(chunks, 100, 200);
    expect(dropCount).toBe(0);
    expect(dropSamples).toBe(0);
  });

  it("drops chunks entirely before the keep window", () => {
    const chunks = [
      new Float32Array(100), // 0–99
      new Float32Array(100), // 100–199
      new Float32Array(100), // 200–299
    ];
    // committed=250, overlap=50 → keepFrom=200 → drop first 2 chunks (200 samples)
    const { dropCount, dropSamples } = computeCompaction(chunks, 250, 50);
    expect(dropCount).toBe(2);
    expect(dropSamples).toBe(200);
  });

  it("does not drop partial chunks", () => {
    const chunks = [
      new Float32Array(100), // 0–99
      new Float32Array(100), // 100–199
    ];
    // committed=180, overlap=50 → keepFrom=130 → only first chunk (100) fits entirely before 130
    const { dropCount, dropSamples } = computeCompaction(chunks, 180, 50);
    expect(dropCount).toBe(1);
    expect(dropSamples).toBe(100);
  });

  it("handles single large chunk that spans the keep window", () => {
    const chunks = [new Float32Array(1000)];
    // committed=500, overlap=100 → keepFrom=400 → chunk is 1000, 1000 > 400, don't drop
    const { dropCount, dropSamples } = computeCompaction(chunks, 500, 100);
    expect(dropCount).toBe(0);
    expect(dropSamples).toBe(0);
  });

  it("drops all chunks when committed far ahead with small overlap", () => {
    const chunks = [
      new Float32Array(100),
      new Float32Array(100),
      new Float32Array(100),
    ];
    // committed=300, overlap=0 → keepFrom=300 → all 300 samples before keepFrom
    const { dropCount, dropSamples } = computeCompaction(chunks, 300, 0);
    expect(dropCount).toBe(3);
    expect(dropSamples).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// computeRms — silence detection
// ---------------------------------------------------------------------------

describe("computeRms", () => {
  it("returns 0 for empty array", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("returns 0 for silence (all zeros)", () => {
    expect(computeRms(new Float32Array(100))).toBe(0);
  });

  it("computes correct RMS for constant signal", () => {
    // constant signal of 0.5: RMS = sqrt(0.25) = 0.5
    const signal = new Float32Array(100).fill(0.5);
    expect(computeRms(signal)).toBeCloseTo(0.5, 5);
  });

  it("handles negative values correctly (alternating ±1)", () => {
    // alternating +1 and -1: RMS = sqrt(1) = 1
    const signal = new Float32Array(100);
    for (let i = 0; i < 100; i++) signal[i] = i % 2 === 0 ? 1 : -1;
    expect(computeRms(signal)).toBeCloseTo(1.0, 5);
  });

  it("returns correct value for single sample", () => {
    expect(computeRms(new Float32Array([0.3]))).toBeCloseTo(0.3, 5);
  });
});

// ---------------------------------------------------------------------------
// uint8ToBase64 — audio encoding for Whisper backend
// ---------------------------------------------------------------------------

describe("uint8ToBase64", () => {
  it("encodes small arrays correctly", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ToBase64(bytes)).toBe(btoa("Hello"));
  });

  it("encodes empty array", () => {
    expect(uint8ToBase64(new Uint8Array(0))).toBe("");
  });

  it("handles arrays larger than chunk size (8192)", () => {
    const size = 8192 * 2 + 100; // spans 3 chunks
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i % 256;
    const result = uint8ToBase64(bytes);
    // Verify by decoding back
    const decoded = atob(result);
    expect(decoded.length).toBe(size);
    for (let i = 0; i < size; i++) {
      expect(decoded.charCodeAt(i)).toBe(i % 256);
    }
  });

  it("matches native btoa for moderate-size input", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const bytes = new Uint8Array(text.split("").map((c) => c.charCodeAt(0)));
    expect(uint8ToBase64(bytes)).toBe(btoa(text));
  });
});
