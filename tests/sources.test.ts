import { describe, expect, it } from "vitest";
import { applyPlan, buildItems, buildUnits, comparePaths, moveNoteIds, planQuote, roughWords, sourceContains, sourceProblems, snapshotId, type NoteInput, type SourceChoice } from "@/helpers/sources";

const FOLDER: SourceChoice = { kind: "folder", path: "Book" };
const note = (path: string, text: string, leaveOut = false): NoteInput => ({
  noteId: `id-${path}`, path, basename: path.split("/").pop()!.replace(/\.md$/u, ""), text, leaveOut,
});
const para = (seed: string, chars: number) => {
  const lines: string[] = [];
  for (let n = 0, i = 0; n < chars; i++) { const line = `${seed} ${i} is a line of plain prose that keeps on going for a while.`; lines.push(line); n += line.length + 1; }
  return lines.join("\n");
};

describe("what belongs to the source", () => {
  it("a folder holds every note under it, at any depth; a note holds only itself", () => {
    expect(sourceContains(FOLDER, "Book/Part 1/01.md")).toBe(true);
    expect(sourceContains(FOLDER, "Bookish/01.md")).toBe(false);
    expect(sourceContains({ kind: "note", path: "Book/a.md" }, "Book/a.md")).toBe(true);
    expect(sourceContains({ kind: "note", path: "Book/a.md" }, "Book/b.md")).toBe(false);
    expect(sourceContains({ kind: "folder", path: "/" }, "Anything/at/all.md")).toBe(true);
  });
});

describe("natural order", () => {
  it("compares numbers as numbers, folder by folder", () => {
    const paths = ["Book/Part 2/1.md", "Book/Part 10/1.md", "Book/Part 2/10.md", "Book/Part 2/2.md"];
    expect([...paths].sort(comparePaths)).toEqual(["Book/Part 2/1.md", "Book/Part 2/2.md", "Book/Part 2/10.md", "Book/Part 10/1.md"]);
  });
});

describe("buildItems", () => {
  it("makes one item per note in natural order, labelled in the writer's own folders", () => {
    const { items } = buildItems([note("Book/Part 2/1 C.md", "c"), note("Book/Part 1/10 B.md", "b"), note("Book/Part 1/2 A.md", "a")], FOLDER);
    expect(items.map((i) => i.label)).toEqual(["Part 1 / 2 A", "Part 1 / 10 B", "Part 2 / 1 C"]);
    expect(items.map((i) => i.id)).toEqual(["id-Book/Part 1/2 A.md", "id-Book/Part 1/10 B.md", "id-Book/Part 2/1 C.md"]);
  });

  it("reports notes with no prose rather than dropping them silently", () => {
    const { items, skipped } = buildItems([note("Book/a.md", "---\nx: 1\n---\n"), note("Book/b.md", "text")], FOLDER);
    expect(skipped).toEqual(["Book/a.md"]);
    expect(items).toHaveLength(1);
  });

  it("keeps a chapter-sized note in a folder whole, whatever headings it has", () => {
    const { items } = buildItems([note("Book/a.md", "## One\nFirst.\n## Two\nSecond.")], FOLDER);
    expect(items).toHaveLength(1);
  });

  it("lists a single note by its headings, including text before the first one", () => {
    const { items } = buildItems([note("Book.md", "Epigraph.\n# One\nFirst.\n# Two\nSecond.")], { kind: "note", path: "Book.md" });
    expect(items.map((i) => i.label)).toEqual(["Book", "One", "Two"]);
    expect(items.map((i) => i.text.trim())).toEqual(["Epigraph.", "One\nFirst.", "Two\nSecond."]);
  });

  it("uses the highest heading level that really divides the note", () => {
    const { items } = buildItems([note("Book.md", "# The Book\n## One\nFirst.\n## Two\nSecond.")], { kind: "note", path: "Book.md" });
    expect(items.map((i) => i.label)).toEqual(["Book", "One", "Two"]);
  });

  it("lists a long note in a folder by its headings too", () => {
    const { items } = buildItems([note("Book/a.md", `# One\n${para("one", 20_000)}\n# Two\n${para("two", 20_000)}`)], FOLDER);
    expect(items.map((i) => i.label)).toEqual(["a / One", "a / Two"]);
  });

  it("gives repeated headings their own stable ids", () => {
    const { items } = buildItems([note("Book.md", "# Scene\nFirst.\n# Scene\nSecond.")], { kind: "note", path: "Book.md" });
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
    const again = buildItems([note("Book.md", "# Scene\nFirst, edited.\n# Scene\nSecond.")], { kind: "note", path: "Book.md" });
    expect(again.items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("holds in any language, because it reads only structure", () => {
    const { items } = buildItems([note("本.md", "# 第一章\n彼女は船を降りた。\n# 第二章\n手紙を読んだ。")], { kind: "note", path: "本.md" });
    expect(items.map((i) => i.label)).toEqual(["第一章", "第二章"]);
  });
});

describe("applyPlan", () => {
  const { items } = buildItems([note("Book/1.md", "a"), note("Book/2.md", "b"), note("Book/3.md", "c")], FOLDER);
  const [one, two, three] = items.map((i) => i.id);

  it("before any plan: natural order, everything in, and the writer must confirm", () => {
    const plan = applyPlan(items, null);
    expect(plan.items.map((i) => i.id)).toEqual([one, two, three]);
    expect(plan.items.every((i) => i.included)).toBe(true);
    expect(plan.needsConfirming).toBe(true);
  });

  it("starts notes marked out of the word count unticked", () => {
    const marked = buildItems([note("Book/1.md", "a"), note("Book/Notes.md", "research", true)], FOLDER).items;
    expect(applyPlan(marked, null).items.map((i) => i.included)).toEqual([true, false]);
  });

  it("keeps the writer's order and exclusions, and does not ask again", () => {
    const plan = applyPlan(items, { order: [three, one, two], excluded: [one] });
    expect(plan.items.map((i) => i.id)).toEqual([three, one, two]);
    expect(plan.items.map((i) => i.included)).toEqual([true, false, true]);
    expect(plan.needsConfirming).toBe(false);
  });

  it("asks again when a note appears, placing it after its natural neighbour", () => {
    const plan = applyPlan(items, { order: [three, one], excluded: [] });
    expect(plan.items.map((i) => i.id)).toEqual([three, one, two]);
    expect(plan.needsConfirming).toBe(true);
  });

  it("asks again when a note disappears", () => {
    expect(applyPlan(items.slice(0, 2), { order: [one, two, three], excluded: [] }).needsConfirming).toBe(true);
  });
});

describe("buildUnits", () => {
  it("sends chapter notes whole, unflagged, and maps them to their note", () => {
    const { items } = buildItems([note("Book/1.md", "---\na: 1\n---\nOne.\nTwo."), note("Book/2.md", "Three.")], FOLDER);
    const { units, pages } = buildUnits(applyPlan(items, null).items);
    expect(units.map((u) => u.part)).toEqual([undefined, undefined]);
    expect(pages[0]).toMatchObject({ noteId: "id-Book/1.md", path: "Book/1.md", noteOffset: 0, order: 0 });
    expect(pages[1]).toMatchObject({ noteId: "id-Book/2.md", order: 1 });
  });

  it("leaves excluded items out and keeps story order dense", () => {
    const { items } = buildItems([note("Book/1.md", "a"), note("Book/2.md", "b"), note("Book/3.md", "c")], FOLDER);
    const plan = applyPlan(items, { order: items.map((i) => i.id), excluded: [items[1].id] });
    const { units } = buildUnits(plan.items);
    expect(units.map((u) => u.text)).toEqual(["a", "c"]);
    expect(units.map((u) => u.order)).toEqual([0, 1]);
  });

  it("follows the writer's order", () => {
    const { items } = buildItems([note("Book/1.md", "a"), note("Book/2.md", "b")], FOLDER);
    const plan = applyPlan(items, { order: [items[1].id, items[0].id], excluded: [] });
    expect(buildUnits(plan.items).units.map((u) => u.text)).toEqual(["b", "a"]);
  });

  it("cuts a long unstructured note into flagged parts whose offsets land on the note's text", () => {
    const text = para("story", 60_000);
    const { items } = buildItems([note("Book.md", `---\na: 1\n---\n${text}`)], { kind: "note", path: "Book.md" });
    const { units, pages } = buildUnits(applyPlan(items, null).items);
    expect(units.length).toBeGreaterThan(2);
    expect(units.every((u) => u.part?.sourceId === items[0].id && u.part.of === units.length)).toBe(true);
    pages.forEach((page, i) => expect(text.slice(page.noteOffset, page.noteOffset + 40)).toBe(units[i].text.slice(0, 40)));
  });

  it("maps a section's units back into the whole note", () => {
    const raw = "Epigraph.\n# One\nFirst.\n# Two\nSecond.";
    const { items } = buildItems([note("Book.md", raw)], { kind: "note", path: "Book.md" });
    const { units, pages } = buildUnits(applyPlan(items, null).items);
    expect(units.map((u, i) => items[0].projectedNote.slice(pages[i].noteOffset, pages[i].noteOffset + u.text.length))).toEqual(units.map((u) => u.text));
  });
});

describe("planQuote", () => {
  it("counts exactly the text that will be sent", () => {
    const { items } = buildItems([note("Book/1.md", "one two"), note("Book/2.md", "three")], FOLDER);
    const plan = applyPlan(items, { order: items.map((i) => i.id), excluded: [items[1].id] });
    expect(planQuote(plan.items)).toEqual({ chars: 7, words: 2, units: 1, sources: 1, problems: [] });
  });
});

describe("sourceProblems", () => {
  it("names a passage that cannot be cut and is too long to send", () => {
    const { items } = buildItems([note("Book/Huge.md", "word ".repeat(31_000).trim())], FOLDER);
    const { units } = buildUnits(applyPlan(items, null).items);
    expect(sourceProblems(units)[0]).toMatch(/Huge.*single paragraph/u);
  });

  it("says when the book is too long to check at once", () => {
    const units = [{ label: "x", text: "a".repeat(3_000_001) }];
    expect(sourceProblems(units)[0]).toMatch(/too long/u);
  });

  it("says when there are too many pieces", () => {
    const units = Array.from({ length: 501 }, () => ({ label: "x", text: "a" }));
    expect(sourceProblems(units)[0]).toMatch(/Leave some out/u);
  });

  it("accepts ordinary books", () => {
    const { items } = buildItems([note("Book/a.md", "Hello.")], FOLDER);
    expect(sourceProblems(buildUnits(applyPlan(items, null).items).units)).toEqual([]);
  });
});

describe("note identity", () => {
  it("follows a renamed note and everything under a renamed folder", () => {
    const ids = { "Book/a.md": "1", "Book/Part/b.md": "2", "Other.md": "3" };
    expect(moveNoteIds(ids, "Book/a.md", "Book/z.md")).toEqual({ "Book/z.md": "1", "Book/Part/b.md": "2", "Other.md": "3" });
    expect(moveNoteIds(ids, "Book", "Novel")).toEqual({ "Novel/a.md": "1", "Novel/Part/b.md": "2", "Other.md": "3" });
  });
});

describe("snapshotId", () => {
  it("changes with the text and with the order", () => {
    const a = snapshotId([{ pageId: "p", order: 0, text: "Hello." }]);
    expect(a).toMatch(/^[a-f0-9]{64}$/u);
    expect(a).not.toBe(snapshotId([{ pageId: "p", order: 0, text: "Hello!" }]));
    expect(a).not.toBe(snapshotId([{ pageId: "p", order: 1, text: "Hello." }]));
  });
  it("roughWords counts whitespace-separated runs", () => { expect(roughWords("a b\nc")).toBe(3); });
});
