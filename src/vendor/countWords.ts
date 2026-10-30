/**
 * The one word counter for writing stats and the editor's word count
 * (adoption roadmap 2.1, language-agnostic mandate).
 *
 * Splitting on whitespace counts a whole Japanese or Chinese sentence as one
 * "word", so CJK writers would barely register and the 2,000-word paste cap
 * would never trip for them. Intl.Segmenter (granularity "word") applies the
 * Unicode/ICU word-break rules for every script; only word-like segments
 * count, so punctuation and dashes are not words. Shared by the main process
 * (save deltas) and the renderer (footer), so both report the same number.
 *
 * Differences from the old whitespace count, by design: "well-known" is two
 * words, a free-standing dash is none. The L14 staleness layer and planner
 * cards still use countProjectionWords (whitespace) because their stored
 * ledger baselines were recorded with it.
 *
 * Falls back to whitespace splitting only where Intl.Segmenter is missing
 * (it ships with Node 16+ and every Chromium Electron uses).
 */
let segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "word" })
        : null;
  }
  return segmenter;
}

/**
 * Long texts are segmented in chunks of about this many characters, cut at
 * whitespace (always a word boundary, so the tokens are identical to one
 * pass). Some engines' Intl.Segmenter is quadratic in the string length
 * (Node 20: 50,000 words took 9 s in one pass, 0.1 s in chunks); chunks keep
 * it linear everywhere.
 */
export const SEGMENT_CHUNK_CHARS = 8_192;
/** How far back from a chunk's end to look for whitespace before a hard cut. */
const CHUNK_BACKOFF_CHARS = 1_024;

function isSpace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x3000 || code === 0x2028 || code === 0x2029;
}

/** Calls `visit` for each word-like segment of `text`, in order. */
function eachWord(text: string, segmenter: Intl.Segmenter, visit: (word: string) => void): void {
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + SEGMENT_CHUNK_CHARS);
    if (end < text.length) {
      let cut = end;
      const floor = Math.max(start + 1, end - CHUNK_BACKOFF_CHARS);
      while (cut > floor && !isSpace(text.charCodeAt(cut))) cut -= 1;
      if (isSpace(text.charCodeAt(cut))) end = cut;
      else {
        // No whitespace nearby (e.g. a long unspaced CJK run): hard cut, never inside a surrogate pair.
        const code = text.charCodeAt(end);
        if (code >= 0xdc00 && code <= 0xdfff) end -= 1;
      }
    }
    for (const segment of segmenter.segment(text.slice(start, end))) {
      if (segment.isWordLike) visit(segment.segment);
    }
    start = end;
  }
}

export function countWords(text: string): number {
  if (!text) return 0;
  const words = getSegmenter();
  if (!words) return text.split(/\s+/).filter(Boolean).length;
  let count = 0;
  eachWord(text, words, () => {
    count += 1;
  });
  return count;
}

/**
 * The word-like segments themselves, in order (the same segmentation as
 * countWords), for the word-level diff of today's writing.
 */
export function wordTokens(text: string): string[] {
  if (!text) return [];
  const words = getSegmenter();
  if (!words) return text.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  eachWord(text, words, (word) => tokens.push(word));
  return tokens;
}
