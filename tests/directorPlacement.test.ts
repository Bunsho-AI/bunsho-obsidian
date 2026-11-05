import { describe, expect, it } from "vitest";
import { cursorContext, keptBlock, planInsert, type PlanInsertInput } from "@/helpers/director/placement";
import { buildItems, type SourceChoice } from "@/helpers/sources";

const note = { noteId: "n1", path: "Book/a.md", basename: "a" };
const folder: SourceChoice = { kind: "folder", path: "Book" };
const whole: SourceChoice = { kind: "note", path: "Book/a.md" };
const place = (raw: string, over: Partial<PlanInsertInput> = {}) => {
  const outcome = planInsert({ raw, note, source: folder, itemId: "n1", placement: "append", prose: "The scene.", ...over });
  if (outcome.kind !== "insert") throw new Error("already placed");
  return { ...outcome.plan, result: raw.slice(0, outcome.plan.offset) + outcome.plan.text + raw.slice(outcome.plan.offset) };
};
const cursorPlace = (raw: string, cursor: number, edited = raw, from = 0, over: Partial<PlanInsertInput> = {}) => place(edited, { placement: "cursor", mark: cursorContext(raw, cursor, from).mark, ...over });

describe("the end of a chapter", () => {
  it("goes after the note's text, a blank line apart", () => {
    expect(place("One.\nTwo.").result).toBe("One.\nTwo.\n\nThe scene.");
    expect(place("One.\nTwo.\n").result).toBe("One.\nTwo.\n\nThe scene.\n");
    expect(place("One.\n\n").result).toBe("One.\n\nThe scene.\n");
  });
  it("in a note split by headings is the end of that plan item, not the note", () => {
    const raw = "# First\nOne.\n\n# Second\nTwo.\n";
    const { items } = buildItems([{ ...note, text: raw }], whole);
    const first = items[0];
    const { result, at, noteEnd } = place(raw, { source: whole, itemId: first.id });
    expect(result).toBe("# First\nOne.\n\nThe scene.\n\n# Second\nTwo.\n");
    expect([at, noteEnd]).toEqual(["end", false]);
    expect(place(raw, { source: whole, itemId: items[1].id }).result).toBe("# First\nOne.\n\n# Second\nTwo.\n\nThe scene.\n");
  });
  it("of a long note cut into pieces is still the end of the plan item", () => {
    const body = Array.from({ length: 900 }, (_, i) => `Paragraph ${i} of a chapter long enough that it reads in several parts, whatever the parts.`).join("\n");
    const raw = `# One\n${body}\n# Two\nShort.\n`;
    const { items } = buildItems([{ ...note, text: raw }], whole);
    expect(items.length).toBe(2);
    const { result } = place(raw, { source: whole, itemId: items[0].id });
    expect(result.endsWith(`${body.slice(-40)}\n\nThe scene.\n\n# Two\nShort.\n`)).toBe(true);
  });
  it("goes to the note's end, and says so, when the plan item has gone", () => {
    const moved = place("# Renamed\nOne.\n\n# Other\nTwo.", { source: whole, itemId: "n1#gone" });
    expect(moved.noteEnd).toBe(true);
    expect(moved.result.endsWith("Two.\n\nThe scene.")).toBe(true);
  });
  it("stays after frontmatter, and a note's closing comment stays where it was", () => {
    expect(place("---\ntitle: x\n---\nOne.").result).toBe("---\ntitle: x\n---\nOne.\n\nThe scene.");
    expect(place("One. %%note%%\n").result).toBe("One. %%note%%\n\nThe scene.\n");
  });
});

describe("at the cursor", () => {
  it("goes where the scene was written for, whatever the cursor does afterwards", () => {
    const raw = "One.\n\nTwo.\n";
    const { result, at } = cursorPlace(raw, 4);
    expect(at).toBe("cursor");
    expect(result).toBe("One.\n\nThe scene.\n\nTwo.\n");
  });
  it("never goes through a line: mid-paragraph is after that paragraph, past any marks", () => {
    expect(cursorPlace("One **bold** two.\nThree.", 7).result).toBe("One **bold** two.\n\nThe scene.\n\nThree.");
    expect(cursorPlace("See [[Note|the link]] here.\nNext.", 8).result).toBe("See [[Note|the link]] here.\n\nThe scene.\n\nNext.");
    expect(cursorPlace("Ends **bold**\nNext.", 13).result).toBe("Ends **bold**\n\nThe scene.\n\nNext.");
  });
  it("before a heading's line, it stays before the mark", () => {
    expect(cursorPlace("One.\n## Two\nThree.", 5).result).toBe("One.\n\nThe scene.\n\n## Two\nThree.");
  });
  it("in the frontmatter or a comment means the story text after it", () => {
    expect(cursorPlace("---\na: b\n---\nOne.\n", 5).result).toBe("---\na: b\n---\n\nThe scene.\n\nOne.\n");
    expect(cursorPlace("One.\n%%\nhidden\n%%\nTwo.\n", 9).at).toBe("cursor");
    expect(cursorPlace("One.\n%%\nhidden\n%%\nTwo.\n", 9).result).not.toContain("hidden\nThe scene");
  });
  it("inside a fenced block means after it", () => {
    expect(cursorPlace("One.\n```\ncode\n```\nTwo.", 10).result).toBe("One.\n```\ncode\n```\n\nThe scene.\n\nTwo.");
  });
  it("sends what stands before the place, from the chapter's start", () => {
    const raw = "# A\nOne.\n# B\nTwo **more** words.\nThree.";
    const from = raw.indexOf("B") - 0;
    const { preceding } = cursorContext(raw, raw.indexOf("more"), buildItems([{ ...note, text: raw }], whole).items[1].from);
    expect(from).toBeGreaterThan(0);
    expect(preceding).toBe("B\nTwo more words.");
  });
  it("still holds when only frontmatter or a comment changed", () => {
    const raw = "---\na: b\n---\nOne.\n\nTwo.";
    const edited = "---\na: changed, and longer\n---\nOne.\n\nTwo.";
    expect(cursorPlace(raw, raw.indexOf("One.") + 4, edited).at).toBe("cursor");
    expect(cursorPlace(raw, raw.indexOf("One.") + 4, edited).result).toBe("---\na: changed, and longer\n---\nOne.\n\nThe scene.\n\nTwo.");
  });
  it("holds when the text after it changed", () => {
    expect(cursorPlace("One.\nTwo.", 4, "One.\nTwo, then more.").result).toBe("One.\n\nThe scene.\n\nTwo, then more.");
  });
  it("goes to the end of the chapter when the text before it changed", () => {
    const { at, result } = cursorPlace("One.\nTwo.", 9, "One, edited.\nTwo.");
    expect(at).toBe("end");
    expect(result).toBe("One, edited.\nTwo.\n\nThe scene.");
  });
  it("goes to the end when the note got shorter than the place, or nothing was remembered", () => {
    expect(cursorPlace("One.\nTwo.", 9, "One").at).toBe("end");
    expect(place("One.\nTwo.", { placement: "cursor" }).at).toBe("end");
  });
  it("holds offsets for text outside the basic plane and with no spaces", () => {
    const raw = "ミラは港に立った。𠮷の文字。\nその目は緑だった。\n次の行。";
    const { result, at } = cursorPlace(raw, raw.indexOf("その"), raw, 0, { prose: "彼女は振り返った。" });
    expect(at).toBe("cursor");
    expect(result).toBe("ミラは港に立った。𠮷の文字。\n\n彼女は振り返った。\n\nその目は緑だった。\n次の行。");
    expect(place("مرحبا بالعالم", { prose: "مشهد جديد" }).result).toBe("مرحبا بالعالم\n\nمشهد جديد");
  });
});

describe("a scene placed twice", () => {
  it("is recognised by its words, wherever it is now", () => {
    expect(planInsert({ raw: "One.\n\nFirst para.\n\nSecond para.\n\nTwo.", note, source: folder, itemId: "n1", placement: "append", prose: "First para.\n\nSecond para." }).kind).toBe("already");
    expect(planInsert({ raw: "One.\n\nFirst para.", note, source: folder, itemId: "n1", placement: "append", prose: "First para.\n\nSecond para." }).kind).toBe("insert");
  });
  it("keeps the draft's paragraphs, a blank line apart", () => {
    expect(keptBlock("  A.\n\n\n\nB.  \n\n")).toBe("A.\n\nB.");
  });
});
