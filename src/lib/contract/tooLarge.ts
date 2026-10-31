/** Size-refusal types and copy, as the plugin says them (desktop shared/continuity/tooLarge.ts is the source of the types). */
export const TOO_LARGE_KINDS = ["one_chapter", "chapter", "book_words", "book_chapters", "context"] as const;
export type TooLargeKind = (typeof TOO_LARGE_KINDS)[number];

export const CHAPTER_SIZE_LIMITS = ["chars", "tokens", "lines"] as const;
export type ChapterSizeLimit = (typeof CHAPTER_SIZE_LIMITS)[number];

const thousands = (n: number): string => (Math.max(0, Math.round(n / 1000)) * 1000).toLocaleString("en-US");
const aboutWords = (n: number): string => (n < 1000 ? Math.max(0, Math.round(n)).toLocaleString("en-US") : thousands(n));

export function bookTooLargeMessage(words: number): string {
  return `This manuscript is too large to check in one review (over ${aboutWords(words)} words).`;
}

export function tooManyChaptersMessage(maxChapters: number): string {
  return `This manuscript has more than ${maxChapters.toLocaleString("en-US")} chapter notes, which is more than one review can take.`;
}

export const CONTEXT_TOO_LARGE_MESSAGE = "This manuscript is too large to check against itself in one review.";
