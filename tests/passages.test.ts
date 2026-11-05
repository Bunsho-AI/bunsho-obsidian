/** The desktop's passage selection cases (passageSelection.test.ts), and cached reads fitting one start frame. */
import { describe, expect, it } from "vitest";
import { castFocus, castNameGroups, fitCachedReads, selectPassages, type PassagePage } from "@/helpers/passages";
import type { CastMember, ChapterRead } from "@/lib/contract/pipelineV3.types";

const page = (pageId: string, pageOrder: number, text: string): PassagePage => ({ pageId, pageOrder, text });
const member = (name: string, extra: Partial<CastMember> = {}): CastMember => ({ id: name, name, kind: "person", names: [name], properNames: [name], aliases: [], chapters: [], roles: [], introduced: [], ...extra });

describe("selectPassages", () => {
  const checked = [page("c", 2, "Mara met the old man at the harbour.")];

  it("keeps only paragraphs that name someone the checked chapter names, with exact offsets", () => {
    const other = "The harbour was quiet.\nMARA's boat was red.\n\nPhilip sailed alone.\n  Mara and Joe argued.";
    const result = selectPassages({ checked, others: [page("o", 0, other)], nameGroups: [["Mara"], ["Philip"], ["Joe"]] });
    expect(result.individuals).toBe(1);
    expect(result.passages).toHaveLength(1);
    const kept = result.passages[0].paragraphs;
    expect(kept.map((p) => p.text)).toEqual(["MARA's boat was red.", "Mara and Joe argued."]);
    for (const p of kept) expect(other.slice(p.start, p.end)).toBe(p.text);
    expect(kept.map((p) => p.index)).toEqual([1, 3]);
    expect(result.chars).toBe(kept.reduce((n, p) => n + p.text.length, 0));
  });

  it("follows every alias of an individual the checked chapter names by any one of them", () => {
    const groups = castNameGroups([member("Philip Pirrip", { properNames: ["Philip Pirrip"], aliases: ["Pip"] })], []);
    const result = selectPassages({ checked: [page("c", 1, "Pip ran.")], others: [page("o", 0, "Philip Pirrip was born.\nNobody else.")], nameGroups: groups });
    expect(result.passages[0].paragraphs.map((p) => p.text)).toEqual(["Philip Pirrip was born."]);
  });

  it("uses proper names and introduced aliases of cached reads, never descriptions", () => {
    const read = { cast: [{ pageId: "c", order: 1, name: "Joe Gargery", kind: "person", role: "smith",
      names: [{ name: "Joe", proper: true }, { name: "the blacksmith", proper: false }], introducedAliases: [{ alias: "Old Joe", quote: "" }] }] } as unknown as ChapterRead;
    expect(castNameGroups([], [read])).toEqual([["Joe Gargery", "Joe", "Old Joe"]]);
  });

  it("does not match a name inside a longer word of a cased script, but matches uncased scripts as substrings", () => {
    const latin = selectPassages({ checked: [page("c", 1, "Al waved.")], others: [page("o", 0, "It was also late.\nAl's hat.")], nameGroups: [["Al"]] });
    expect(latin.passages[0].paragraphs.map((p) => p.text)).toEqual(["Al's hat."]);
    const japanese = selectPassages({ checked: [page("c", 1, "裕太は走った。")], others: [page("o", 0, "昨日、裕太は海を見た。\n雨だった。")], nameGroups: [["裕太"]] });
    expect(japanese.passages[0].paragraphs.map((p) => p.text)).toEqual(["昨日、裕太は海を見た。"]);
  });

  it("skips lone cased letters as names", () => {
    const result = selectPassages({ checked: [page("c", 1, "I think so.")], others: [page("o", 0, "I was there.")], nameGroups: [["I"]] });
    expect(result.individuals).toBe(0);
    expect(result.passages).toEqual([{ pageId: "o", paragraphs: [] }]);
  });

  it("caps paragraphs per page, preferring those naming more individuals", () => {
    const lines = Array.from({ length: 60 }, (_, i) => (i === 59 ? "Mara and Joe met." : `Mara line ${i}.`));
    const result = selectPassages({ checked: [page("c", 1, "Mara and Joe.")], others: [page("o", 0, lines.join("\n"))], nameGroups: [["Mara"], ["Joe"]], maxPerPage: 40 });
    const kept = result.passages[0].paragraphs;
    expect(kept).toHaveLength(40);
    expect(kept.map((p) => p.text)).toContain("Mara and Joe met.");
    expect(kept.map((p) => p.index)).toEqual([...kept.map((p) => p.index)].sort((a, b) => a - b));
  });

  it("caps total characters, keeping the chapters nearest the checked one", () => {
    const line = `Mara ${"x".repeat(95)}`;
    const text = Array.from({ length: 30 }, () => line).join("\n");
    const others = [page("far", 0, text), page("near", 9, text)];
    const result = selectPassages({ checked: [page("c", 10, "Mara.")], others, nameGroups: [["Mara"]], maxTotalChars: 4_000 });
    const [far, near] = result.passages;
    expect(near.paragraphs).toHaveLength(30);
    expect(far.paragraphs).toHaveLength(10);
    expect(result.chars).toBeLessThanOrEqual(4_000);
  });

  it("sends no passages when nothing names anyone (no cast yet and no cached reads)", () => {
    const result = selectPassages({ checked, others: [page("o", 0, "Mara again.")], nameGroups: [] });
    expect(result.passages).toEqual([{ pageId: "o", paragraphs: [] }]);
  });
});

describe("castFocus", () => {
  const jaggers = member("Mr. Jaggers", { names: ["Mr. Jaggers", "the burly gentleman"], properNames: ["Mr. Jaggers", "Jaggers"] });
  const joe = member("Joe", { names: ["Joe", "the blacksmith"], properNames: ["Joe"] });
  const fact = (pageId: string, paragraph: number, subject: string) => ({ id: `${pageId}#${paragraph}`, pageId, order: 0, span: { start: 0, end: 1 }, quote: "x",
    paragraph, subject, attribute: "a", kind: "trait" as const, statement: "s", question: "q", framing: "narration" as const, speaker: null, textMarksUntrue: false });
  const read = (pageId: string, facts: ReturnType<typeof fact>[]) => ({ pageId, order: 0, rev: "r", droppedFacts: 0, povBreaks: [], cast: [], facts,
    narration: { person: "first" as const, povCharacter: "Pip", tense: "past" as const } }) as ChapterRead;

  it("finds the checked chapter's people by the cast and sends every name the cast gives them", () => {
    const focus = castFocus({ cast: [jaggers, joe], checked: [page("c", 48, "It was Mr. Jaggers's hand.")], reads: [] });
    expect(focus.focusNames).toEqual(["Mr. Jaggers", "the burly gentleman", "Jaggers"]);
  });

  it("marks the paragraphs of other chapters that hold a fact about them, however the fact names them", () => {
    const focus = castFocus({ cast: [jaggers, joe], checked: [page("c", 48, "It was Mr. Jaggers's hand.")],
      reads: [read("o", [fact("o", 2, "the burly gentleman"), fact("o", 3, "the blacksmith")])] });
    expect([...(focus.factParagraphs.get("o") ?? [])]).toEqual([2]);
  });

  it("sends a fact paragraph that names nobody ahead of the name matches", () => {
    const other = page("o", 11, "Mr. Jaggers was mentioned.\nHe had an exceedingly dark complexion.");
    const result = selectPassages({ checked: [page("c", 48, "Mr. Jaggers again.")], others: [other], nameGroups: [["Mr. Jaggers"]],
      factParagraphs: new Map([["o", new Set([1])]]), maxPerPage: 1 });
    expect(result.passages[0].paragraphs.map((p) => p.text)).toEqual(["He had an exceedingly dark complexion."]);
  });
});

describe("fitCachedReads", () => {
  const read = (pageId: string, order: number, size = 10): ChapterRead => ({ pageId, order, rev: "r", facts: [], cast: [], narration: { person: "third", povCharacter: "x".repeat(size), tense: "past" }, povBreaks: [], droppedFacts: 0 });

  it("returns everything in story order when it fits", () => {
    expect(fitCachedReads([read("b", 1), read("a", 0)], [1], new Set(["b"]), 10_000).map((r) => r.pageId)).toEqual(["a", "b"]);
  });

  it("keeps the checked chapters' own reads first, then the nearest", () => {
    const reads = [read("far", 0, 400), read("near", 8, 400), read("checked", 9, 400)];
    const size = JSON.stringify(reads[0]).length + 1;
    expect(fitCachedReads(reads, [9], new Set(["checked"]), size * 2 + 10).map((r) => r.pageId)).toEqual(["near", "checked"]);
    expect(fitCachedReads(reads, [9], new Set(["checked"]), size + 10).map((r) => r.pageId)).toEqual(["checked"]);
  });

  it("skips a read too large for the frame, and tries the next", () => {
    const small = read("small", 5);
    expect(fitCachedReads([read("big", 8, 900), small], [9], new Set(), JSON.stringify(small).length + 1).map((r) => r.pageId)).toEqual(["small"]);
  });
});
