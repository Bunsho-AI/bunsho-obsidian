import { describe, expect, it } from "vitest";
import { buildChapters, chapterProblems, snapshotId } from "../src/structure";

const note = (name: string, text: string) => ({ path: `Manuscript/${name}.md`, basename: name, text });

describe("buildChapters", () => {
  it("orders notes by name with numbers compared as numbers", () => {
    const { chapters } = buildChapters([note("10 Ten", "ten"), note("2 Two", "two"), note("1 One", "one")]);
    expect(chapters.map((c) => c.title)).toEqual(["1 One", "2 Two", "10 Ten"]);
    expect(chapters.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it("skips notes with no prose and keeps order dense", () => {
    const { chapters, skipped } = buildChapters([note("01 A", "---\nx: 1\n---\n"), note("02 B", "text")]);
    expect(skipped).toEqual([{ path: "Manuscript/01 A.md", reason: "empty" }]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].order).toBe(0);
  });

  it("gives every chapter a path id and a content hash", () => {
    const { chapters } = buildChapters([note("01 A", "Hello.")]);
    expect(chapters[0].pageId).toBe("Manuscript/01 A.md");
    expect(chapters[0].rev).toMatch(/^[a-f0-9]{64}$/);
  });

  it("snapshot ids change when text changes", () => {
    const a = buildChapters([note("01 A", "Hello.")]).chapters;
    const b = buildChapters([note("01 A", "Hello!")]).chapters;
    expect(snapshotId(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotId(a)).not.toBe(snapshotId(b));
  });
});

describe("chapterProblems", () => {
  it("names a chapter with too many paragraphs before anything is sent", () => {
    const { chapters } = buildChapters([note("07 Long", Array.from({ length: 1201 }, (_, i) => `Line ${i}.`).join("\n"))]);
    expect(chapterProblems(chapters)[0]).toContain("07 Long");
  });

  it("names a chapter that is too long", () => {
    const { chapters } = buildChapters([note("08 Huge", "word ".repeat(31_000))]);
    expect(chapterProblems(chapters)[0]).toMatch(/08 Huge.*too long/);
  });

  it("accepts ordinary chapters", () => {
    expect(chapterProblems(buildChapters([note("01 A", "Hello.")]).chapters)).toEqual([]);
  });
});
