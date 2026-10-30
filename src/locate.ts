/** Where a finding's quote sits in the note now, as note offsets, or null when the passage has changed since the check. */
import type { Projection } from "./projection";
import type { EngineIssueCitation } from "./vendor/engine.types";

export function locateQuote(citation: Pick<EngineIssueCitation, "quoted_text" | "source_ref">, projection: Projection, rev: string | null): { from: number; to: number } | null {
  const quote = citation.quoted_text;
  if (!quote) return null;
  const ref = citation.source_ref;
  let start = -1;
  if (ref && rev !== null && rev === ref.rev && projection.text.slice(ref.start, ref.end) === quote) start = ref.start;
  else {
    const found = projection.text.indexOf(quote);
    // Ambiguous repeats are not guessed at: the quote must be the only occurrence.
    if (found >= 0 && projection.text.indexOf(quote, found + 1) === -1) start = found;
  }
  if (start < 0) return null;
  return { from: projection.toSource(start), to: projection.toSourceEnd(start + quote.length) };
}
