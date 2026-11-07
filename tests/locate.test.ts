import { describe, expect, it } from "vitest";
import { projectMarkdown } from "@/utils/markdown";
import { locateQuote } from "@/helpers/locate";

const raw = "# One\nHer eyes were *green*.\nLater, her eyes were green again.\n";
const projection = projectMarkdown(raw);
const quote = "Her eyes were green.";
const ref = (start: number) => ({ snapshotId: "s", pageId: "p", rev: "r", start, end: start + quote.length });

describe("locateQuote", () => {
  it("uses the recorded offsets when the note is unchanged", () => {
    const hit = locateQuote({ quoted_text: quote, source_ref: ref(projection.text.indexOf(quote)) }, projection, 0);
    expect(hit && raw.slice(hit.from, hit.to)).toBe("Her eyes were *green*.");
  });

  it("adds where the page starts in the note, for a page cut from a longer note", () => {
    const start = projection.text.indexOf(quote);
    const hit = locateQuote({ quoted_text: quote, source_ref: ref(start - 4) }, projection, 4);
    expect(hit && raw.slice(hit.from, hit.to)).toBe("Her eyes were *green*.");
  });

  it("finds a repeated quote at its recorded place", () => {
    const twice = projectMarkdown("Same line.\nOther.\nSame line.\n");
    const later = twice.text.lastIndexOf("Same line.");
    const hit = locateQuote({ quoted_text: "Same line.", source_ref: { snapshotId: "s", pageId: "p", rev: "r", start: later, end: later + 10 } }, twice, 0);
    expect(hit?.from).toBe(later);
  });

  it("finds a unique quote after the note was edited", () => {
    const edited = projectMarkdown("A new first line.\n" + raw);
    expect(locateQuote({ quoted_text: quote, source_ref: ref(projection.text.indexOf(quote)) }, edited, 0)).not.toBeNull();
  });

  it("refuses an ambiguous or missing quote", () => {
    expect(locateQuote({ quoted_text: "eyes were green" }, projection, 0)).toBeNull();
    expect(locateQuote({ quoted_text: "Nothing like this." }, projection, 0)).toBeNull();
  });
});
