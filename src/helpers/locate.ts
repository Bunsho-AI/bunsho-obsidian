/** Where a finding's quote sits in the note now, as note offsets, or null when the passage has changed since the check. */
import type { Projection } from "@/utils/markdown";
import type { EngineIssueCitation } from "@/lib/contract/engine.types";

/** `pageOffset`: where the cited page starts in the note's projected text. Citation offsets are into the page. */
export function locateQuote(citation: Pick<EngineIssueCitation, "quoted_text" | "source_ref">, projection: Projection, pageOffset: number): { from: number; to: number } | null {
  const quote = citation.quoted_text;
  if (!quote) return null;
  const ref = citation.source_ref;
  let start = -1;
  if (ref && projection.text.slice(pageOffset + ref.start, pageOffset + ref.end) === quote) start = pageOffset + ref.start;
  else {
    const found = projection.text.indexOf(quote);
    // Ambiguous repeats are not guessed at: the quote must be the only occurrence.
    if (found >= 0 && projection.text.indexOf(quote, found + 1) === -1) start = found;
  }
  if (start < 0) return null;
  return { from: projection.toSource(start), to: projection.toSourceEnd(start + quote.length) };
}
