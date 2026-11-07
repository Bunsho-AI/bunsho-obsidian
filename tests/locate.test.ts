import { describe, expect, it } from "vitest";
import { projectMarkdown } from "@/utils/markdown";
import { locateQuote } from "@/helpers/locate";
import { sha256 } from "@/utils/hash";

const raw = "# One\nHer eyes were *green*.\nLater, her eyes were green again.\n";
const projection = projectMarkdown(raw);
const rev = sha256(projection.text);
const quote = "Her eyes were green.";

describe("locateQuote", () => {
  it("uses the recorded offsets when the chapter is unchanged", () => {
    const start = projection.text.indexOf(quote);
    const hit = locateQuote({ quoted_text: quote, source_ref: { snapshotId: "s", pageId: "p", rev, start, end: start + quote.length } }, projection, rev);
    expect(hit && raw.slice(hit.from, hit.to)).toBe("Her eyes were *green*.");
  });

  it("finds a unique quote after the chapter was edited", () => {
    const edited = projectMarkdown("A new first line.\n" + raw);
    const hit = locateQuote({ quoted_text: quote }, edited, sha256(edited.text));
    expect(hit).not.toBeNull();
  });

  it("refuses an ambiguous or missing quote", () => {
    expect(locateQuote({ quoted_text: "eyes were green" }, projection, rev)).toBeNull();
    expect(locateQuote({ quoted_text: "Nothing like this." }, projection, rev)).toBeNull();
  });
});
