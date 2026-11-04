/**
 * A page's paragraphs and scene breaks exactly as the engine computes them: a port of `paragraphs()` and `isSceneBreak()`
 * in bunsho-engine src/claims/text/manuscript.ts (one contract; change both together). Line structure and character
 * classes only, never words, so it holds in every language.
 */
export interface Paragraph {
  index: number;
  start: number;
  end: number;
  text: string;
}

export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const pattern = /[^\n]+/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!body) continue;
    const start = (match.index ?? 0) + lead;
    out.push({ index: out.length, start, end: start + body.length, text: body });
  }
  return out;
}

export function isSceneBreak(p: Pick<Paragraph, "text">): boolean {
  return !/[\p{L}\p{N}]/u.test(p.text);
}
