import { describe, expect, it } from "vitest";
import { isSceneBreak, paragraphs } from "@/lib/reading/paragraphs";
import { READING_LIMITS, buildReadingUnits, toSourceOffset, type SourceText } from "@/lib/reading/units";
import { sha256 } from "@/utils/hash";

const hash = (text: string) => sha256(text);
/** Paragraphs of about `size` chars, each with distinct words. */
const prose = (count: number, size = 400, tag = "p"): string =>
  Array.from({ length: count }, (_, i) => `${tag}${i} `.repeat(Math.ceil(size / `${tag}${i} `.length)).trim()).join("\n");
const note = (sourceId: string, text: string, headings?: SourceText["headings"]): SourceText => ({ sourceId, label: sourceId, text, headings });

describe("paragraph rules", () => {
  it("match the engine: non-empty trimmed lines with exact offsets", () => {
    expect(paragraphs("  one \n\n two")).toEqual([
      { index: 0, start: 2, end: 5, text: "one" },
      { index: 1, start: 9, end: 12, text: "two" },
    ]);
  });

  it("see scene breaks by shape in any script", () => {
    expect(isSceneBreak({ text: "---" })).toBe(true);
    expect(isSceneBreak({ text: "* * *" })).toBe(true);
    expect(isSceneBreak({ text: "§" })).toBe(true);
    expect(isSceneBreak({ text: "第一章" })).toBe(false);
  });
});

describe("buildReadingUnits", () => {
  it("sends a section up to the threshold whole, with no part flag", () => {
    const text = prose(80);
    expect(text.length).toBeLessThan(READING_LIMITS.wholeChars);
    const [unit, ...rest] = buildReadingUnits([note("a.md", text)], { hash });
    expect(rest).toEqual([]);
    expect(unit).toMatchObject({ pageId: "a.md", order: 0, text, sourceOffset: 0 });
    expect(unit.part).toBeUndefined();
  });

  it("never merges across sources, however short", () => {
    const units = buildReadingUnits([note("a.md", "One line."), note("b.md", "Another."), note("c.md", "   ")], { hash });
    expect(units.map((u) => u.pageId)).toEqual(["a.md", "b.md"]);
    expect(units.map((u) => u.order)).toEqual([0, 1]);
  });

  it("cuts a long unstructured source into parts inside the size range, losing no paragraph", () => {
    const text = prose(300);
    const units = buildReadingUnits([note("book.md", text)], { hash });
    expect(units.length).toBeGreaterThan(5);
    for (const unit of units.slice(0, -1)) {
      expect(unit.text.length).toBeGreaterThanOrEqual(READING_LIMITS.minPartChars - 500);
      expect(unit.text.length).toBeLessThanOrEqual(READING_LIMITS.maxPartChars);
    }
    expect(units.at(-1)?.text.length).toBeGreaterThanOrEqual(READING_LIMITS.minTailChars);
    expect(units.flatMap((u) => paragraphs(u.text).map((p) => p.text))).toEqual(paragraphs(text).map((p) => p.text));
    units.forEach((u, index) => expect(u.part).toEqual({ sourceId: "book.md", sourceOrder: 0, index, of: units.length }));
  });

  it("maps every unit offset back to the exact source text", () => {
    const text = `\n\n${prose(300)}`;
    for (const unit of buildReadingUnits([note("book.md", text)], { hash })) {
      const at = toSourceOffset(unit, 20);
      expect(text.slice(at, at + 30)).toBe(unit.text.slice(20, 50));
    }
  });

  it("prefers a scene break for a cut and ends the part on it", () => {
    const paras = prose(300).split("\n");
    paras.splice(30, 0, "* * *");
    const units = buildReadingUnits([note("book.md", paras.join("\n"))], { hash });
    expect(units[0].text.endsWith("* * *")).toBe(true);
  });

  it("divides at the highest headings first, as real boundaries with no part flag", () => {
    const one = `Chapter one\n${prose(60, 400, "a")}`;
    const two = `Chapter two\n${prose(60, 400, "b")}`;
    const text = `${one}\n${two}`;
    const units = buildReadingUnits([note("book.md", text, [{ offset: 0, level: 1 }, { offset: one.length + 1, level: 1 }])], { hash });
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.label)).toEqual(["book.md", "Chapter two"]);
    expect(units.every((u) => !u.part)).toBe(true);
  });

  it("keeps text before the first heading, under the source's label", () => {
    const body = prose(100);
    const text = `Dedication\n${body}\nChapter one\n${body}`;
    const units = buildReadingUnits([note("book.md", text, [{ offset: `Dedication\n${body}\n`.length, level: 1 }])], { hash });
    expect(units[0].text.startsWith("Dedication")).toBe(true);
    expect(units[0].label).toBe("book.md");
  });

  it("gives repeated headings distinct stable ids", () => {
    const part = `Scene\n${prose(60)}`;
    const text = `${part}\n${part}`;
    const units = buildReadingUnits([note("n.md", text, [{ offset: 0, level: 2 }, { offset: part.length + 1, level: 2 }])], { hash });
    expect(new Set(units.map((u) => u.pageId)).size).toBe(units.length);
  });

  it("keeps later cuts in place after an early edit", () => {
    const paras = prose(600).split("\n");
    const before = buildReadingUnits([note("book.md", paras.join("\n"))], { hash });
    const edited = [...paras];
    edited[2] = `${edited[2]} A sentence the writer added.`;
    const after = buildReadingUnits([note("book.md", edited.join("\n"))], { hash });
    const beforeRevs = new Set(before.map((u) => u.rev));
    const unchanged = after.filter((u) => beforeRevs.has(u.rev)).length;
    expect(unchanged).toBeGreaterThanOrEqual(before.length - 3);
    expect(new Set(after.map((u) => u.pageId)).has(before.at(-1)!.pageId)).toBe(true);
  });

  it("gives duplicate parts unique ids", () => {
    const line = "same words here ".repeat(30).trim();
    const units = buildReadingUnits([note("book.md", Array.from({ length: 400 }, () => line).join("\n"))], { hash });
    expect(new Set(units.map((u) => u.pageId)).size).toBe(units.length);
  });

  it("does not cut inside one huge paragraph, and sends it as one piece", () => {
    const units = buildReadingUnits([note("book.md", "word ".repeat(10_000).trim())], { hash });
    expect(units).toHaveLength(1);
  });

  it("cuts non-Latin text by the page token limit before the character limit would", () => {
    const line = "彼女の目は緑色だった。".repeat(40);
    const text = Array.from({ length: 200 }, (_, i) => `${i}${line}`).join("\n");
    const units = buildReadingUnits([note("本.md", text)], { hash });
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => u.text.length <= READING_LIMITS.wholeChars)).toBe(true);
    expect(units.flatMap((u) => paragraphs(u.text).map((p) => p.text))).toEqual(paragraphs(text).map((p) => p.text));
  });

  it("cuts a source with too many paragraphs even when it is short", () => {
    const text = Array.from({ length: 1_300 }, (_, i) => `L${i}`).join("\n");
    expect(text.length).toBeLessThan(READING_LIMITS.wholeChars);
    expect(buildReadingUnits([note("book.md", text)], { hash, minPartChars: 800, maxPartChars: 1_600 }).length).toBeGreaterThan(1);
  });

  it("honours bench overrides for forced cuts", () => {
    const units = buildReadingUnits([note("book.md", prose(70))], { hash, wholeChars: 12_000 });
    expect(units.length).toBeGreaterThan(1);
  });

  it("numbers parts in step with uncut pages, so chapter labels never repeat or go backwards", () => {
    const long = (seed: string) => Array.from({ length: 900 }, (_, i) => `${seed} ${i} is a line of plain prose that keeps going.`).join("\n");
    const units = buildReadingUnits([{ sourceId: "a", label: "A", text: long("a") }, { sourceId: "b", label: "B", text: "Short." }, { sourceId: "c", label: "C", text: long("c") }], { hash: (t) => t.slice(0, 8) });
    const labels = units.map((u) => u.part?.sourceOrder ?? u.order);
    expect([...labels].sort((x, y) => x - y)).toEqual(labels);
    const b = units.find((u) => u.sourceId === "b")!;
    const c = units.find((u) => u.sourceId === "c")!;
    expect(c.part!.sourceOrder).toBeGreaterThan(b.order);
  });
});
