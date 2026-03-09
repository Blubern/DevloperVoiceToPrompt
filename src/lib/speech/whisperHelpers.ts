// ---------------------------------------------------------------------------
// Pure helper functions extracted from WhisperSpeechProvider for testability.
// These handle text reconciliation, stability detection, and audio buffer
// management without any browser API or Tauri dependencies.
// ---------------------------------------------------------------------------

/**
 * Collapse whitespace and trim.
 */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Given committed words and a new transcription, strip the overlap prefix
 * and return only the genuinely new text.
 *
 * Uses longest-suffix matching: tries to match the full committed phrase
 * at the start of the new words, then progressively shorter suffixes.
 * Case-insensitive comparison.
 *
 * @returns The new text after stripping the overlap, or "" if nothing new.
 */
/**
 * Normalize a word for comparison: lowercase and strip punctuation/symbols.
 * Handles cases like "hello," vs "hello" or "it's" vs "its".
 */
function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function stripOverlap(committedWords: string[], transcription: string): string {
  const trimmed = cleanText(transcription);
  if (!trimmed) return "";
  if (committedWords.length === 0) return trimmed;

  const words = trimmed.split(/\s+/);
  let bestMatchLen = 0;

  for (let startIdx = 0; startIdx < committedWords.length; startIdx++) {
    const suffix = committedWords.slice(startIdx);
    if (suffix.length > words.length) continue;
    let match = true;
    for (let j = 0; j < suffix.length; j++) {
      if (normalizeWord(suffix[j]) !== normalizeWord(words[j])) {
        match = false;
        break;
      }
    }
    if (match) {
      bestMatchLen = suffix.length;
      break;
    }
  }

  return words.slice(bestMatchLen).join(" ");
}

/**
 * Track stability of interim text across decode cycles.
 * Returns updated state and whether the text should be committed as final.
 */
export function checkStability(
  text: string,
  lastInterim: string,
  stabilityHits: number,
  stabilityThreshold: number,
): { newLastInterim: string; newStabilityHits: number; shouldCommit: boolean } {
  const hits = text === lastInterim ? stabilityHits + 1 : 1;
  return {
    newLastInterim: text,
    newStabilityHits: hits,
    shouldCommit: hits >= stabilityThreshold,
  };
}

/**
 * Concatenate an array of Float32Array chunks into a single flat buffer.
 * Optionally reuses an existing buffer to avoid allocation on every call.
 */
export function buildSessionBuffer(
  chunks: Float32Array[],
  totalSamples: number,
  existingBuffer?: Float32Array,
): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  if (chunks.length === 1) return chunks[0];
  let buffer = existingBuffer;
  if (!buffer || buffer.length < totalSamples) {
    buffer = new Float32Array(totalSamples);
  }
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer;
}

/**
 * Determine how many chunks can be dropped from the front to bound memory,
 * preserving the overlap window.
 */
export function computeCompaction(
  chunks: Float32Array[],
  committedSamples: number,
  overlapSamples: number,
): { dropCount: number; dropSamples: number } {
  const keepFrom = Math.max(0, committedSamples - overlapSamples);
  if (keepFrom <= 0) return { dropCount: 0, dropSamples: 0 };
  let accumulated = 0;
  let dropCount = 0;
  let dropSamples = 0;
  for (const chunk of chunks) {
    if (accumulated + chunk.length <= keepFrom) {
      accumulated += chunk.length;
      dropCount++;
      dropSamples += chunk.length;
    } else {
      break;
    }
  }
  return { dropCount, dropSamples };
}

/**
 * Compute the RMS (root mean square) of a Float32Array signal.
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

/**
 * Encode a Uint8Array to base64 using chunked conversion to avoid
 * stack overflow on large arrays.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}
