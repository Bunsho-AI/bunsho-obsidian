/** The check loop, against the mock engine's real protocol: what goes on the wire, what is charged, and above all what may close a card. */
import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { ContinuityController, type ControllerHost, type PlanAnswer, type PlanRequest } from "@/controllers/ContinuityController";
import { itemAtOffset, type PlannedItem } from "@/helpers/sources";
import { projectMarkdown } from "@/utils/markdown";
import type { PluginData } from "@/types";

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

const planOf = (r: PlanRequest): PlanAnswer => ({ kind: "plan", plan: { order: r.items.map((i) => i.id), excluded: [] } });
const WORLD = "plugins/bunsho/world.json";

interface Options {
  notes: Record<string, string>;
  host?: Partial<ControllerHost>;
  engine?: Parameters<typeof startMockEngine>[0];
  world?: Iterable<[string, string]>;
  data?: Record<string, unknown>;
  active?: () => string | null;
  /** Runs as the world file is written. */
  onWorldWrite?: () => Promise<void>;
}

async function setup(options: Options) {
  const { notes } = options;
  engine = engine ?? await startMockEngine({ balance: 100_000, tickMs: 1, ...options.engine });
  const files = () => Object.keys(notes).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/u, ""), extension: "md" }));
  const stored = new Map<string, string>(options.world ?? []);
  const app = {
    secretStorage: { getSecret: () => "", setSecret: () => undefined },
    vault: {
      getName: () => "Vault", getMarkdownFiles: files, getAllLoadedFiles: () => [],
      getFileByPath: (path: string) => (notes[path] === undefined ? null : { path }),
      getFolderByPath: (path: string) => (Object.keys(notes).some((n) => n.startsWith(`${path}/`)) ? { path } : null),
      adapter: {
        exists: (path: string) => Promise.resolve(stored.has(path) || [...stored.keys()].some((key) => key.startsWith(`${path}/`))),
        read: (path: string) => Promise.resolve(stored.get(path) ?? ""),
        write: async (path: string, text: string) => { stored.set(path, text); await options.onWorldWrite?.(); },
        remove: (path: string) => { stored.delete(path); return Promise.resolve(); },
        mkdir: () => Promise.resolve(),
        list: (path: string) => Promise.resolve({ files: [...stored.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")), folders: [] }),
        rmdir: (path: string) => { for (const key of [...stored.keys()]) if (key.startsWith(`${path}/`)) stored.delete(key); return Promise.resolve(); },
      },
      read: (file: { path: string }) => Promise.resolve(notes[file.path]),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => { const path = options.active?.(); return path ? { path } : null; } },
    metadataCache: { getFileCache: () => null },
  };
  let data: unknown = { engineUrl: `http://127.0.0.1:${engine.port}`, devUid: "test", source: { kind: "folder", path: "Book" }, workspaceId: "w", installId: "i", ...options.data };
  let plans = 0;
  const controller = new ContinuityController({
    app: app as never, version: "0.1.0", dir: "plugins/bunsho", loadData: () => Promise.resolve(data), saveData: (next: PluginData) => { data = next; return Promise.resolve(); },
    openPanel: () => Promise.resolve(), changed: () => undefined, confirmCheck: () => Promise.resolve("check"), reviewPlan: (r) => { plans++; return Promise.resolve(planOf(r)); },
    pickSource: () => Promise.resolve(null), pickIssue: () => Promise.resolve(null), confirmReplaceProject: () => Promise.resolve(true), ...options.host,
  });
  await controller.load();
  await controller.refreshAccount();
  return { controller, notes, stored, data: () => data as PluginData, plans: () => plans };
}

/** A book checked once, whole, with a contradiction between a and b. */
const BOOK = () => ({ "Book/a.md": "Mira stepped ashore.\nHer eyes were green.", "Book/b.md": "Mira read the letter.\nHer eyes were brown.", "Book/c.md": "Nothing of note happens here." });

async function checked(options: Partial<Options> = {}) {
  const made = await setup({ notes: BOOK(), ...options });
  await made.controller.editPlan();
  await made.controller.check();
  expect(made.controller.phase.kind).toBe("idle");
  return made;
}

const itemId = (c: ContinuityController, label: string): string => {
  const { scan } = c;
  if (scan.status !== "ready") throw new Error("not ready");
  return scan.items.find((item) => item.label === label)!.id;
};
const lastStart = () => engine!.starts[engine!.starts.length - 1];
const openIds = (c: ContinuityController) => c.currentReview()!.issues.map((i) => i.issue_id).filter((id) => !c.data.fixed.includes(id) && !c.data.dismissed.includes(id));
const onlyIssue = (c: ContinuityController) => { const [issue] = c.currentReview()!.issues; return issue; };
const rescan = (c: ContinuityController) => c.refreshScan();

describe("the first whole-book check", () => {
  it("is what opens chapter checks; before it there is no chapter check, no review of changes and no Check if fixed", async () => {
    const { controller } = await setup({ notes: BOOK(), active: () => "Book/a.md" });
    await controller.editPlan();
    expect(controller.chapterChecksOpen()).toBe(false);
    expect(controller.chapterTarget()).toBeNull();
    expect(controller.changedChapters()).toBeNull();
    await controller.check();
    expect(controller.chapterChecksOpen()).toBe(true);
    expect(controller.chapterTarget()?.label).toBe("a");
    expect(controller.recheckQuote(onlyIssue(controller).issue_id)).toBe(36);
  });

  it("refuses a chapter check with no book behind it, before anything is spent", async () => {
    const { controller } = await setup({ notes: BOOK() });
    await controller.editPlan();
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(controller.phase).toMatchObject({ kind: "error" });
    expect(engine!.starts).toHaveLength(0);
  });

  it("a file from before chapter checks fills the World and is never sent, and does not open them", async () => {
    const first = await checked();
    const { reads, cast } = JSON.parse(first.stored.get(WORLD)!) as { reads: Array<{ read: unknown }>; cast: unknown[] };
    const saved = first.data();
    const { ledger: _ledger, ...oldReview } = saved.lastReview!;
    const old = await setup({ notes: BOOK(), world: [[WORLD, JSON.stringify({ version: 1, checkedAt: 1, reads: reads.map((e) => e.read), cast })]], data: { ...saved, lastReview: oldReview } as unknown as Record<string, unknown> });
    expect(old.controller.chapterChecksOpen()).toBe(false);
    expect(old.controller.worldEntities()?.[0].name).toBe("Mira");
    await old.controller.check();
    expect(lastStart().cachedReads).toEqual([]);
    expect(old.controller.chapterChecksOpen()).toBe(true);
  });

  it("closes them when the engine's read policy changes", async () => {
    const { controller } = await checked();
    engine!.options.currentReadPolicy = "c".repeat(64);
    await controller.refreshAccount();
    expect(controller.chapterChecksOpen()).toBe(false);
  });

  it("a full review answered under another read policy keeps its reads for the World and sends none back", async () => {
    const { controller, stored } = await setup({ notes: BOOK(), engine: { readPolicy: "c".repeat(64) } });
    await controller.editPlan();
    await controller.check();
    expect(controller.worldEntities()).not.toBeNull();
    expect((JSON.parse(stored.get(WORLD)!) as { reads: Array<{ readPolicyId: unknown }> }).reads.every((e) => e.readPolicyId === null)).toBe(true);
    expect(controller.chapterChecksOpen()).toBe(false);
  });

  it("survives closing and reopening", async () => {
    const first = await checked();
    const stored = [...first.stored];
    const data = first.data() as unknown as Record<string, unknown>;
    const second = await setup({ notes: BOOK(), world: stored, data });
    await second.controller.refreshScan();
    expect(second.controller.chapterChecksOpen()).toBe(true);
  });
});

describe("check one chapter", () => {
  it("sends that chapter whole and lists every other page as passages, with the cast's names and the book's reads", async () => {
    const { controller, notes } = await checked();
    notes["Book/b.md"] = "Mira read the letter again.\nHer eyes were brown.";
    await rescan(controller);
    const pagesSent = engine!.sentPages.length;
    const passagesSent = engine!.sentPassages.length;
    await controller.checkChapter(itemId(controller, "b"), 36);
    const start = lastStart();
    expect(start.scope).toBe("chapters");
    expect(start.pages.map((p) => [p.send])).toEqual([["passages"], ["whole"], ["passages"]]);
    expect(start.maxCredits).toBe(36);
    expect(start.focusNames).toContain("Mira");
    // Its own old read does not go back: the text changed. The others' do.
    expect(start.cachedReads.map((r) => r.order)).toEqual([0, 2]);
    expect(engine!.sentPages.slice(pagesSent).map((p) => p.text)).toEqual([notes["Book/b.md"]]);
    expect(engine!.sentPassages.slice(passagesSent)).toHaveLength(2);
    // A page naming nobody involved is still listed, with no paragraphs.
    const [a, c] = engine!.sentPassages.slice(passagesSent);
    expect(a.paragraphs.map((p) => p.text)).toContain("Mira stepped ashore.");
    expect(c.paragraphs).toEqual([]);
    expect(controller.phase.kind).toBe("idle");
  });

  it("uses a new review id each time", async () => {
    const { controller } = await checked();
    await controller.checkChapter(itemId(controller, "a"), 36);
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(new Set(engine!.starts.map((s) => s.reviewId)).size).toBe(3);
  });

  it("charges only the chapter, whatever the book's size", async () => {
    const long = "x".repeat(10_000);
    const { controller } = await checked({ notes: { ...BOOK(), "Book/c.md": long }, engine: { enforce: true, balance: 10_000 } });
    expect(controller.price()).toBe(12 * 11);
    const before = engine!.balance();
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(before - engine!.balance()).toBe(36);
    expect(lastStart().maxCredits).toBe(36);
    expect(engine!.sentPages[engine!.sentPages.length - 1].text).not.toContain("xxx");
  });

  it("refuses when the chapter now costs more than the writer confirmed, and nothing is sent", async () => {
    const { controller, notes } = await checked();
    notes["Book/a.md"] = `${"y".repeat(6000)}\nHer eyes were green.`;
    await rescan(controller);
    const starts = engine!.starts.length;
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(controller.phase).toMatchObject({ kind: "error", charged: false, action: { kind: "chapter" } });
    expect(engine!.starts).toHaveLength(starts);
    expect(controller.retryQuote()).toBe(12 * 7);
    await controller.retry();
    expect(lastStart().maxCredits).toBe(12 * 7);
  });

  it("new notes go past the writer first: the plan opens, and nothing is sent", async () => {
    const { controller, notes, plans } = await checked();
    notes["Book/d.md"] = "Private notes nobody has seen on the plan.";
    await rescan(controller);
    const starts = engine!.starts.length;
    const plansBefore = plans();
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(plans()).toBe(plansBefore + 1);
    expect(engine!.starts).toHaveLength(starts);
    expect(controller.phase.kind).toBe("idle");
  });

  it("an unticked note is not sent, even as a passage", async () => {
    const notes = { ...BOOK(), "Book/research.md": "Mira's secret research." };
    const { controller } = await setup({ notes, host: { reviewPlan: (r) => Promise.resolve({ kind: "plan", plan: { order: r.items.map((i) => i.id), excluded: r.items.filter((i) => i.label === "research").map((i) => i.id) } }) } });
    await controller.editPlan();
    await controller.check();
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(JSON.stringify(engine!.sentPassages)).not.toContain("secret");
    expect(lastStart().pages).toHaveLength(3);
  });

  it("a long note cut into parts: the chapter's every part goes whole, other chapters' parts as passages, priced by chapter", async () => {
    const prose = (seed: string, chars: number) => { const lines: string[] = []; for (let n = 0, i = 0; n < chars; i++) { const line = `${seed} ${i} is a line of plain prose that keeps on going.`; lines.push(line); n += line.length + 1; } return lines.join("\n"); };
    const notes = { "Book/a.md": prose("alpha", 40_000), "Book/b.md": prose("beta", 40_000), "Book/c.md": "Short." };
    const { controller } = await setup({ notes });
    await controller.editPlan();
    await controller.check();
    if (controller.scan.status !== "ready") throw new Error("not ready");
    const aParts = controller.scan.pages.filter((p) => p.sourceId === itemId(controller, "a"));
    expect(aParts.length).toBeGreaterThan(1);
    const credits = controller.recheckQuote("nothing") ?? 12 * Math.ceil(controller.scan.itemChars[itemId(controller, "a")] / 1000);
    await controller.checkChapter(itemId(controller, "a"), credits);
    const start = lastStart();
    expect(start.pages.filter((p) => p.send === "whole").map((p) => p.pageId).sort()).toEqual(aParts.map((p) => p.pageId).sort());
    expect(start.pages.filter((p) => p.send === "passages" && p.part).length).toBeGreaterThan(0);
    expect(controller.phase.kind).toBe("idle");
  });

  it("merges a chapter's cast and keeps the rest", async () => {
    const { controller, stored } = await checked();
    const before = JSON.parse(stored.get(WORLD)!) as { fromFullReview: boolean };
    expect(before.fromFullReview).toBe(true);
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect((JSON.parse(stored.get(WORLD)!) as { fromFullReview: boolean }).fromFullReview).toBe(true);
  });

  it("does not prune on a single chapter's check", async () => {
    const { controller, notes } = await checked();
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green too.";
    await rescan(controller);
    await controller.checkChapter(itemId(controller, "b"), 36);
    expect(controller.currentReview()!.issues).toHaveLength(1);
  });
});

describe("the chapter under the cursor", () => {
  it("is a plan item, chosen by where the cursor falls in the note's own text", () => {
    const raw = "---\ntitle: x\n---\n# One\nFirst.\n# Two\nSecond.\n# Three\nThird.";
    const projection = projectMarkdown(raw);
    const item = (id: string, from: number, included = true): PlannedItem => ({ id, noteId: "n", path: "n.md", label: id, from, text: "", headings: [], leaveOut: false, projectedNote: projection.text, included });
    const items = [item("one", 0), item("two", projection.text.indexOf("Two")), item("three", projection.text.indexOf("Three"))];
    expect(itemAtOffset(items, "n", projection.fromSource(raw.indexOf("Second")))?.id).toBe("two");
    expect(itemAtOffset(items, "n", projection.fromSource(raw.indexOf("# Three")))?.id).toBe("three");
    expect(itemAtOffset(items, "n", projection.fromSource(0))?.id).toBe("one");
    expect(itemAtOffset(items, "n", null)?.id).toBe("one");
    expect(itemAtOffset(items, "other", 0)).toBeNull();
    expect(itemAtOffset([item("left", 0, false)], "n", 0)).toBeNull();
  });

  it("is not offered for a note outside the plan, or with no note open", async () => {
    let active: string | null = "Elsewhere/note.md";
    const { controller } = await checked({ active: () => active });
    expect(controller.chapterTarget()).toBeNull();
    active = null;
    expect(controller.chapterTarget()).toBeNull();
    active = "Book/b.md";
    expect(controller.chapterTarget()).toMatchObject({ label: "b", credits: 36 });
  });
});

describe("review changed chapters", () => {
  it("says what changed and what it costs, and checks only those", async () => {
    const { controller, notes } = await checked();
    expect(controller.changedChapters()).toBeNull();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    expect(controller.changedChapters()).toEqual({ count: 1, credits: 36 });
    await controller.reviewChanged(36);
    const start = lastStart();
    expect(start.scope).toBe("chapters");
    expect(start.pages.filter((p) => p.send === "whole")).toHaveLength(1);
    expect(start.maxCredits).toBe(36);
    expect(controller.changedChapters()).toBeNull();
  });

  it("moving a chapter leaves it pending, as a changed one is", async () => {
    let order = ["a", "b", "c"];
    const { controller } = await setup({ notes: BOOK(), host: { reviewPlan: (r) => Promise.resolve({ kind: "plan", plan: { order: order.map((label) => r.items.find((i) => i.label === label)!.id), excluded: [] } }) } });
    await controller.editPlan();
    await controller.check();
    order = ["b", "a", "c"];
    await controller.editPlan();
    expect(controller.changedChapters()?.count).toBe(2);
  });

  it("a policy change leaves everything pending", async () => {
    const { controller } = await checked();
    engine!.options.policyId = "d".repeat(64);
    await controller.refreshAccount();
    expect(controller.changedChapters()?.count).toBe(3);
  });

  it("retires a fixed finding, as a sweep may", async () => {
    const { controller, notes } = await checked();
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    await controller.reviewChanged(36);
    expect(controller.currentReview()!.issues).toEqual([]);
  });

  it("retires nothing when the engine's caps left pairs unjudged", async () => {
    const { controller, notes } = await checked();
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    engine!.options.capped = true;
    await controller.reviewChanged(36);
    expect(controller.currentReview()!.issues).toHaveLength(1);
  });

  it("a chapter edited during the run stays changed, from the revision that was sent", async () => {
    const notes = BOOK();
    let edit: (() => void) | null = null;
    let phase = (): string => "";
    const { controller } = await checked({ notes, host: { changed: () => { if (phase() === "checking" && edit) { edit(); edit = null; } } } });
    phase = () => controller.phase.kind;
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    edit = () => { notes["Book/c.md"] = "Something else again happens here."; };
    await controller.reviewChanged(36);
    expect(controller.stoppedReview()).toMatchObject({ status: "partial", checked: 0, failed: 1, total: 1, message: "Chapters edited during the review were not saved; review them again. Findings for the other chapters were kept." });
    expect(controller.changedChapters()?.count).toBe(1);
  });
});

describe("check if fixed: a false fixed is the worst outcome", () => {
  it("an edited sentence comes back with a new id, maps to the old card and does not close it", async () => {
    const { controller, notes } = await checked();
    const before = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nBy then her eyes were brown and tired.";
    await rescan(controller);
    const result = await controller.recheck(before.issue_id, 36);
    expect(result).toEqual({ kind: "complete", message: "Recheck complete." });
    expect(controller.data.fixed).toEqual([]);
    expect(controller.currentReview()!.issues.map((i) => i.issue_id)).toEqual([before.issue_id]);
    expect(onlyIssue(controller).citations[1].quoted_text).toBe("By then her eyes were brown and tired.");
    // The engine really did answer under another id.
    expect(engine!.starts.length).toBe(2);
  });

  it("closes a card only when it is gone from text the writer changed", async () => {
    const { controller, notes } = await checked();
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    const start = () => lastStart();
    expect(await controller.recheck(id, 36)).toEqual({ kind: "closed", message: "Issue no longer detected after targeted recheck." });
    expect(controller.data.fixed).toEqual([id]);
    expect(start().pages.filter((p) => p.send === "whole")).toHaveLength(2);
    expect(start().maxCredits).toBe(36);
    expect(openIds(controller)).toEqual([]);
    // Still on the list, as the desktop keeps it, under "closed auto".
    expect(controller.currentReview()!.issues).toHaveLength(1);
  });

  it("a card found again by a later review reopens; a dismissed one stays dismissed", async () => {
    const { controller, notes } = await checked();
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    await controller.recheck(id, 36);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were brown.";
    await rescan(controller);
    await controller.checkChapter(itemId(controller, "b"), 36);
    expect(controller.data.fixed).toEqual([]);
    expect(openIds(controller)).toEqual([id]);

    await controller.dismiss(id, true);
    notes["Book/b.md"] = "Mira read the letter.\nBy then her eyes were brown and tired.";
    await rescan(controller);
    await controller.checkChapter(itemId(controller, "b"), 36);
    expect(controller.currentReview()!.issues.map((i) => i.issue_id)).toEqual([id]);
    expect(controller.data.dismissed).toEqual([id]);
    expect(openIds(controller)).toEqual([]);
  });

  it("text nobody edited stays open, even when the engine does not find the problem this time", async () => {
    const { controller } = await checked();
    const { issue_id: id } = onlyIssue(controller);
    engine!.options.findNothing = true;
    expect(await controller.recheck(id, 36)).toEqual({ kind: "complete", message: "Recheck complete." });
    expect(controller.data.fixed).toEqual([]);
  });

  const edited = async () => {
    const made = await checked({ notes: { ...BOOK(), "Book/a.md": "Mira stepped ashore.\nHer eyes were green.\nThe boat was red.", "Book/b.md": "Mira read the letter.\nHer eyes were brown.\nThe boat was blue." } });
    expect(made.controller.currentReview()!.issues).toHaveLength(2);
    made.notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.\nThe boat was blue.";
    await rescan(made.controller);
    return { ...made, id: made.controller.currentReview()!.issues.find((i) => i.type === "trait_contradiction")!.issue_id };
  };

  it("does not close on a failed review, and says so", async () => {
    const { controller, id } = await edited();
    engine!.options.failAfterReads = { code: "internal", message: "The review failed. This review was charged.", charged: true };
    const result = await controller.recheck(id, 36);
    expect(result).toEqual({ kind: "incomplete", message: "Recheck incomplete. Existing findings were preserved. The review failed. This review was charged." });
    expect(controller.data.fixed).toEqual([]);
    expect(controller.phase.kind).toBe("idle");
  });

  it("does not close when a cited chapter could not be read", async () => {
    const { controller, id } = await edited();
    engine!.options.unread = "all";
    expect((await controller.recheck(id, 36)).kind).toBe("incomplete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("does not close when the engine's caps left pairs unjudged", async () => {
    const { controller, id } = await edited();
    engine!.options.capped = true;
    expect((await controller.recheck(id, 36)).kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("does not close when a chapter is edited while the check runs", async () => {
    const notes = BOOK();
    let edit: (() => void) | null = null;
    let phase = (): string => "";
    const { controller } = await checked({ notes, host: { changed: () => { if (phase() === "checking" && edit) { edit(); edit = null; } } } });
    phase = () => controller.phase.kind;
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    edit = () => { notes["Book/b.md"] = "Mira read the letter.\nHer eyes were grey."; };
    const result = await controller.recheck(id, 36);
    expect(result.kind).toBe("incomplete");
    expect(result.message).toContain("edited while it was being checked");
    expect(controller.data.fixed).toEqual([]);
  });

  it("does not close when the engine's policy moved under the check", async () => {
    const { controller, id } = await edited();
    const stream = engine!.options;
    const result = controller.recheck(id, 36);
    while (controller.phase.kind !== "checking") await new Promise((done) => setTimeout(done, 1));
    stream.policyId = "e".repeat(64);
    expect((await result).kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("does not close a card whose save failed", async () => {
    let fail = false;
    const notes = BOOK();
    const made = await checked({ notes, host: { saveData: () => (fail ? Promise.reject(new Error("disk")) : Promise.resolve()) } });
    const { controller } = made;
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    fail = true;
    const result = await controller.recheck(id, 36);
    expect(result.kind).toBe("incomplete");
    expect(result.message).toContain("could not be saved");
    expect(controller.data.fixed).toEqual([]);
  });

  it("a long note whose cut moves when it is edited is still the same chapter: the card stays open", async () => {
    const prose = (seed: string, chars: number) => { const lines: string[] = []; for (let n = 0, i = 0; n < chars; i++) { const line = `${seed} ${i} is a line of plain prose that keeps on going.`; lines.push(line); n += line.length + 1; } return lines.join("\n"); };
    const body = `${prose("alpha", 20_000)}\nHer eyes were green.\n${prose("omega", 20_000)}`;
    const notes: Record<string, string> = { "Book/a.md": body, "Book/b.md": "Her eyes were brown.", "Book/c.md": "Nothing." };
    const { controller } = await checked({ notes });
    const issue = onlyIssue(controller);
    const cited = issue.citations[0];
    const part = controller.currentReview()!.pages.find((p) => p.pageId === cited.page_id)!;
    expect(part.sourceId).toBe(itemId(controller, "a"));
    expect(part.pageId).toContain("~");
    // Rewrite the first paragraph of the cited part: its id is that paragraph's hash. The contradiction itself is untouched.
    const firstLine = engine!.sentPages.find((p) => p.pageId === cited.page_id)!.text.split("\n")[0];
    notes["Book/a.md"] = body.replace(firstLine, `${firstLine} Rewritten.`);
    await rescan(controller);
    if (controller.scan.status !== "ready") throw new Error("not ready");
    expect(controller.scan.pages.some((p) => p.pageId === cited.page_id)).toBe(false);
    const quote = controller.recheckQuote(issue.issue_id)!;
    const result = await controller.recheck(issue.issue_id, quote);
    expect(result).toEqual({ kind: "complete", message: "Recheck complete." });
    expect(controller.data.fixed).toEqual([]);
    expect(controller.currentReview()!.issues.map((i) => i.issue_id)).toEqual([issue.issue_id]);
    expect(onlyIssue(controller).citations[0].page_id).not.toBe(cited.page_id);
  });

  it("does not close when the engine's answer lost a finding on the way: it may have been this one", async () => {
    const { controller, id } = await edited();
    // The boat is still contradicted; its current passage is not an exact slice of what was sent, so grounding drops the finding.
    engine!.options.tamper = true;
    expect((await controller.recheck(id, 36)).kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("a sign-out while the result is being kept brings nothing back", async () => {
    let signOut: (() => Promise<void>) | null = null;
    const made = await checked({ onWorldWrite: async () => { const go = signOut; signOut = null; if (go) { void go(); await new Promise((done) => setTimeout(done, 20)); } } });
    const { controller, notes, data } = made;
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.";
    await rescan(controller);
    signOut = () => controller.signOut();
    await controller.recheck(id, 36);
    expect(data().lastReview?.issues.map((issue) => issue.issue_id)).toContain(id);
    expect(data().fixed).toEqual([]);
  });

  it("only the card asked about can close: another finding the same check did not repeat stays open", async () => {
    const notes = { "Book/a.md": "Her eyes were green.\nThe boat was red.", "Book/b.md": "Her eyes were brown.\nThe boat was blue.", "Book/c.md": "Nothing." };
    const { controller } = await checked({ notes });
    const issues = controller.currentReview()!.issues;
    expect(issues).toHaveLength(2);
    const eyes = issues.find((i) => i.type === "trait_contradiction")!;
    const boat = issues.find((i) => i.type === "object_state_violation")!;
    notes["Book/b.md"] = "Her eyes were green.\nThe boat was red.";
    await rescan(controller);
    await controller.recheck(eyes.issue_id, 36);
    expect(controller.data.fixed).toEqual([eyes.issue_id]);
    expect(openIds(controller)).toEqual([boat.issue_id]);
  });

  it("a new problem found by the check is added and does not take over the card", async () => {
    const notes = BOOK();
    const { controller } = await checked({ notes });
    const { issue_id: id } = onlyIssue(controller);
    notes["Book/b.md"] = "Mira read the letter.\nHer eyes were green.\nThe boat was blue.";
    notes["Book/a.md"] = "Mira stepped ashore.\nHer eyes were green.\nThe boat was red.";
    await rescan(controller);
    await controller.recheck(id, 36);
    expect(controller.currentReview()!.issues.map((i) => i.type).sort()).toEqual(["object_state_violation", "trait_contradiction"]);
  });

  it("offers no check for a finding citing a chapter no longer on the plan", async () => {
    const notes: Record<string, string> = BOOK();
    const { controller } = await checked({ notes });
    const { issue_id: id } = onlyIssue(controller);
    delete notes["Book/b.md"];
    await rescan(controller);
    expect(controller.recheckQuote(id)).toBeNull();
  });
});

describe("stopped reviews", () => {
  it("out of credits: the findings stay, the status says stopped, and it is priced to retry from the button", async () => {
    const { controller, notes, data } = await checked({ engine: { enforce: true, balance: 40 } });
    const issues = controller.currentReview()!.issues;
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    // The panel knows the balance first; the engine refuses too, should another machine have spent it.
    (controller as unknown as { account: { balance: number } }).account.balance = 100;
    const spend = (controller as unknown as { refreshAccount(): Promise<void> }).refreshAccount;
    (controller as unknown as { refreshAccount: () => Promise<void> }).refreshAccount = () => Promise.resolve();
    await controller.reviewChanged(36);
    (controller as unknown as { refreshAccount: () => Promise<void> }).refreshAccount = spend;
    expect(controller.stoppedReview()).toMatchObject({ status: "out_of_credits", checked: 0, total: 1, credits: 36 });
    expect(controller.currentReview()!.issues).toEqual(issues);
    expect(data().stopped?.status).toBe("out_of_credits");
    expect(controller.phase.kind).toBe("idle");
  });

  it("a balance read too low refuses before anything is sent", async () => {
    const { controller, notes } = await checked({ engine: { enforce: true, balance: 40 } });
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    const starts = engine!.starts.length;
    await controller.reviewChanged(36);
    expect(controller.phase).toMatchObject({ kind: "error", message: "This check costs about 36 credits and you have 4. Add credits in Bunsho, then try again." });
    expect(engine!.starts).toHaveLength(starts);
  });

  it("a charged failure keeps its reads, offers a retry, and the retry sends them back under a new review", async () => {
    const { controller, notes, stored } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.failAfterReads = { code: "internal", message: "The review failed. This review was charged.", charged: true };
    await controller.reviewChanged(36);
    expect(controller.phase).toMatchObject({ kind: "error", charged: true, action: { kind: "changes" } });
    expect(controller.retryQuote()).toBe(36);
    const kept = JSON.parse(stored.get(WORLD)!) as { reads: Array<{ read: { rev: string; pageId: string } }> };
    if (controller.scan.status !== "ready") throw new Error("not ready");
    const page = controller.scan.pages.find((p) => p.sourceId === itemId(controller, "c"))!;
    expect(kept.reads.some((e) => e.read.pageId === page.pageId && e.read.rev === page.rev)).toBe(true);
    // Still pending: nothing was recorded as checked.
    expect(controller.changedChapters()?.count).toBe(1);

    engine!.options.failAfterReads = null;
    const failedId = lastStart().reviewId;
    await controller.retry();
    expect(lastStart().reviewId).not.toBe(failedId);
    expect(lastStart().cachedReads.some((r) => r.pageId === page.pageId && r.rev === page.rev)).toBe(true);
    expect(controller.changedChapters()).toBeNull();
    expect(controller.phase.kind).toBe("idle");
  });

  it("a read the post-review scan could not confirm is still kept, having been paid for", async () => {
    let fail = false;
    const notes = BOOK();
    const made = await checked({ notes });
    const { controller, stored } = made;
    const app = (controller as unknown as { host: { app: { vault: { read: (f: { path: string }) => Promise<string> } } } }).host.app;
    const read = app.vault.read;
    app.vault.read = (f) => (fail ? Promise.reject(new Error("locked")) : read(f));
    const run = controller.check();
    while (controller.phase.kind !== "checking") await new Promise((done) => setTimeout(done, 1));
    fail = true;
    await run;
    fail = false;
    expect((JSON.parse(stored.get(WORLD)!) as { reads: unknown[] }).reads).not.toEqual([]);
  });

  it("the World keeps showing a page as of its last check after a stopped run read a newer revision", async () => {
    const { controller, notes } = await checked();
    const row = controller.worldEntities()![0].rows.find((r) => r.value === "green")!;
    notes["Book/a.md"] = "Mira stepped ashore.\nHer eyes were hazel.";
    await rescan(controller);
    engine!.options.failAfterReads = { code: "internal", message: "The review failed. This review was charged.", charged: true };
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(controller.worldEntities()![0].rows.find((r) => r.key === row.key)?.value).toBe("green");
    expect(controller.factNote(row)).toBe("edited since the check");
  });

  it("a read the engine refuses is forgotten, so the next try can run", async () => {
    const { controller, stored } = await checked();
    engine!.options.refuseCached = true;
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(controller.phase).toMatchObject({ kind: "error" });
    // No retry of a chapter check: with the reads gone it would be refused. The whole-book check is the way back.
    expect((controller.phase as { action?: unknown }).action).toBeUndefined();
    expect((JSON.parse(stored.get(WORLD)!) as { reads: Array<{ readPolicyId: unknown }> }).reads.every((e) => e.readPolicyId === null)).toBe(true);
    expect(controller.chapterChecksOpen()).toBe(false);
    expect(controller.worldEntities()).not.toBeNull();
    await controller.check();
    expect(lastStart().cachedReads).toEqual([]);
    expect(controller.phase.kind).toBe("idle");
    expect(controller.chapterChecksOpen()).toBe(true);
  });

  it("a chapter the engine could not read says so, and stays pending", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.unread = "all";
    await controller.reviewChanged(36);
    expect(controller.stoppedReview()).toMatchObject({ status: "partial", checked: 0, failed: 1, message: "One chapter could not be read this time; the rest of the book was checked. Its 12 credits were refunded. Review it again." });
    expect(controller.changedChapters()?.count).toBe(1);
    engine!.options.unread = [];
    await controller.reviewChanged(36);
    expect(controller.stoppedReview()).toBeNull();
  });

  it("the writer can put a stopped review's message away, and the status line stays", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.unread = "all";
    await controller.reviewChanged(36);
    await controller.dismissStopped();
    expect(controller.stoppedReview()).toMatchObject({ status: "partial", message: null });
  });

  const cancelMidRun = async (controller: ContinuityController) => {
    const run = controller.reviewChanged(36);
    while (controller.phase.kind !== "checking") await new Promise((done) => setTimeout(done, 1));
    while (engine!.starts.length === 0) await new Promise((done) => setTimeout(done, 1));
    await new Promise((done) => setTimeout(done, 15));
    controller.cancel();
    await run;
  };

  it("a cancelled review the engine says it charged says so, and stays pending", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.tickMs = 200;
    engine!.options.cancelFrame = { code: "cancelled", message: "Review cancelled. This review was charged.", charged: true };
    await cancelMidRun(controller);
    expect(controller.stoppedReview()).toMatchObject({ status: "partial", checked: 0, total: 1, message: "Review cancelled. This review was charged." });
    expect(controller.changedChapters()?.count).toBe(1);
  });

  it("a cancelled review whose charge is unknown does not pretend it was free", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.tickMs = 200;
    await cancelMidRun(controller);
    expect(controller.stoppedReview()).toMatchObject({ status: "partial", message: "Review cancelled." });
  });

  it("a cancelled review the engine did not charge leaves nothing behind", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.tickMs = 200;
    engine!.options.cancelFrame = { code: "cancelled", message: "Review cancelled. You were not charged.", charged: false };
    await cancelMidRun(controller);
    expect(controller.phase.kind).toBe("idle");
    expect(controller.stoppedReview()).toBeNull();
    expect(controller.changedChapters()?.count).toBe(1);
  });

  it("too large offers no retry: it would fail the same way", async () => {
    const { controller } = await checked();
    engine!.options.failWith = "too_large";
    await controller.checkChapter(itemId(controller, "a"), 36);
    expect(controller.phase).toMatchObject({ kind: "error" });
    expect((controller.phase as { action?: unknown }).action).toBeUndefined();
  });

  it("signing out keeps the stopped review", async () => {
    const { controller, notes } = await checked();
    notes["Book/c.md"] = "Something else happens here.";
    await rescan(controller);
    engine!.options.unread = "all";
    await controller.reviewChanged(36);
    const { stopped } = controller.data;
    expect(stopped).not.toBeNull();
    await controller.signOut();
    expect(controller.data.stopped).toEqual(stopped);
  });

  it("damaged saved state does not reach the panel", async () => {
    const { controller } = await setup({ notes: BOOK(), data: { stopped: { status: "nonsense" }, fixed: "broken" } });
    expect(controller.data.stopped).toBeNull();
    expect(controller.data.fixed).toEqual([]);
  });
});
