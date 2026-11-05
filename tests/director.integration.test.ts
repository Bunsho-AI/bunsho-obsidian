/** The Director through its controller, against the mock engine and a fake vault: what is sent, what is charged, where a scene goes, and that it goes once. */
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownView } from "obsidian";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { ContinuityController, type PlanRequest } from "@/controllers/ContinuityController";
import { DirectorController, type SceneResult } from "@/controllers/DirectorController";
import type { PluginData } from "@/types";

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

const BOOK = (): Record<string, string> => ({ "Book/a.md": "Mira came in.\nHer eyes were green.\n", "Book/b.md": "Mira left.\nThe gulls settled.\n" });
const posOf = (text: string, offset: number) => { const before = text.slice(0, offset).split("\n"); return { line: before.length - 1, ch: before[before.length - 1].length }; };
const offsetOf = (text: string, pos: { line: number; ch: number }) => text.split("\n").slice(0, pos.line).reduce((n, l) => n + l.length + 1, 0) + pos.ch;

function fakeEditor(notes: Record<string, string>, path: string, cursor: number) {
  const editor = {
    cursor, transactions: 0,
    getValue: () => notes[path],
    getCursor: () => posOf(notes[path], editor.cursor),
    posToOffset: (pos: { line: number; ch: number }) => offsetOf(notes[path], pos),
    offsetToPos: (offset: number) => posOf(notes[path], offset),
    scrollIntoView: () => undefined,
    transaction: ({ changes }: { changes: { from: { line: number; ch: number }; text: string }[] }) => {
      editor.transactions++;
      for (const change of changes) { const at = offsetOf(notes[path], change.from); notes[path] = notes[path].slice(0, at) + change.text + notes[path].slice(at); }
    },
  };
  return editor;
}

async function setup(options: { notes?: Record<string, string>; engine?: Parameters<typeof startMockEngine>[0]; stored?: Map<string, string>; failSceneWrite?: () => boolean; source?: { kind: "folder" | "note"; path: string } } = {}) {
  const notes = options.notes ?? BOOK();
  engine = engine ?? await startMockEngine({ balance: 100_000, tickMs: 1, ...options.engine });
  const stored = options.stored ?? new Map<string, string>();
  const views: { view: MarkdownView }[] = [];
  let active: string | null = null;
  const processed: string[] = [];
  const files = () => Object.keys(notes).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/u, ""), extension: "md" }));
  const app = {
    secretStorage: { getSecret: () => "", setSecret: () => undefined },
    vault: {
      getName: () => "Vault", getMarkdownFiles: files, getAllLoadedFiles: () => [],
      getFileByPath: (path: string) => (notes[path] === undefined ? null : { path }),
      getFolderByPath: (path: string) => (Object.keys(notes).some((n) => n.startsWith(`${path}/`)) ? { path } : null),
      process: (file: { path: string }, fn: (data: string) => string) => { processed.push(file.path); notes[file.path] = fn(notes[file.path]); return Promise.resolve(notes[file.path]); },
      adapter: {
        exists: (path: string) => Promise.resolve(stored.has(path) || [...stored.keys()].some((key) => key.startsWith(`${path}/`))),
        read: (path: string) => Promise.resolve(stored.get(path) ?? ""),
        write: (path: string, text: string) => { if (options.failSceneWrite?.() && path.includes("/scenes/")) return Promise.reject(new Error("disk")); stored.set(path, text); return Promise.resolve(); },
        remove: (path: string) => { stored.delete(path); return Promise.resolve(); },
        list: (path: string) => Promise.resolve({ files: [...stored.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")), folders: [] }),
        rename: (from: string, to: string) => { stored.set(to, stored.get(from) ?? ""); stored.delete(from); return Promise.resolve(); },
        mkdir: () => Promise.resolve(),
        rmdir: (path: string) => { for (const key of [...stored.keys()]) if (key.startsWith(`${path}/`)) stored.delete(key); return Promise.resolve(); },
      },
      read: (file: { path: string }) => Promise.resolve(notes[file.path]),
    },
    workspace: { getLeavesOfType: (type: string) => (type === "markdown" ? views : []), getActiveFile: () => (active ? { path: active } : null), getMostRecentLeaf: () => views.at(-1) ?? null },
    metadataCache: { getFileCache: () => null },
  };
  let data: unknown = { engineUrl: `http://127.0.0.1:${engine.port}`, devUid: "test", source: options.source ?? { kind: "folder", path: "Book" }, workspaceId: "w", installId: "i" };
  const continuity = new ContinuityController({
    app: app as never, version: "0.1.0", dir: "plugins/bunsho", loadData: () => Promise.resolve(data), saveData: (next: PluginData) => { data = next; return Promise.resolve(); },
    openPanel: () => Promise.resolve(), changed: () => undefined, confirmCheck: () => Promise.resolve("check"),
    reviewPlan: (r: PlanRequest) => Promise.resolve({ kind: "plan", plan: { order: r.items.map((i) => i.id), excluded: [] } }),
    pickSource: () => Promise.resolve(null), pickIssue: () => Promise.resolve(null), confirmReplaceProject: () => Promise.resolve(true),
  });
  await continuity.load();
  await continuity.refreshAccount();
  await continuity.editPlan();
  const director = new DirectorController(app as never, continuity, () => undefined);
  await director.whenLoaded();
  const open = (path: string, cursor: number) => {
    const editor = fakeEditor(notes, path, cursor);
    const view = Object.assign(new (MarkdownView as unknown as new () => MarkdownView)(), { file: { path }, editor, mode: "source", getMode() { return (this as unknown as { mode: string }).mode; } });
    views.push({ view });
    active = path;
    return Object.assign(editor, { reading: () => { (view as unknown as { mode: string }).mode = "preview"; } });
  };
  const itemOf = (path: string) => { const { scan } = continuity; if (scan.status !== "ready") throw new Error("no scan"); return scan.items.find((i) => i.path === path)!.id; };
  return { continuity, director, notes, stored, open, itemOf, processed, activate: (path: string) => { active = path; }, engine };
}
const ok = (result: SceneResult) => { if (!result.ok) throw new Error(JSON.stringify(result.failure)); return result.scene; };
type Made = Awaited<ReturnType<typeof setup>>;
async function drafted(made: Made, placement: "append" | "cursor" = "append", path = "Book/a.md") {
  const anchor = { itemId: made.itemOf(path), placement };
  const card = ok(await made.director.plan("Mira finds the letter. Nobody speaks.", anchor));
  return ok(await made.director.write({ sceneId: card.sceneId, anchor }));
}
const calls = (route: string) => engine!.directorCalls.filter((call) => call.url === route);
const keep = (made: Made, sceneId: string) => made.director.keep(sceneId, () => "Chapter");

describe("planning and writing", () => {
  it("reads the engine's prices, and plans for 33 and writes for 67 a beat, with a key each", async () => {
    const made = await setup();
    expect([made.director.planPrice, made.director.beatPrice]).toEqual([33, 67]);
    const scene = await drafted(made);
    expect(engine!.balance()).toBe(100_000 - 33 - 3 * 67);
    expect(calls("/v1/plan")[0].key).toBeTruthy();
    expect(calls("/v1/render/scene")[0].key).not.toBe(calls("/v1/plan")[0].key);
    expect(scene.draft?.wordCount).toBeGreaterThan(0);
    expect(scene.status).toBe("rendering");
  });
  it("shows no price the engine did not give", async () => {
    const made = await setup({ engine: { noOpCosts: true } });
    expect([made.director.planPrice, made.director.beatPrice]).toEqual([null, null]);
  });
  it("sends the chapter as the prose it continues from, and strips what only this machine knows", async () => {
    const made = await setup();
    const scene = await drafted(made);
    expect(calls("/v1/plan")[0].body.precedingProse).toBe("Mira came in.\nHer eyes were green.\n");
    const sent = calls("/v1/render/scene")[0].body.scene as Record<string, unknown>;
    expect(sent.direction).toBeUndefined();
    expect(sent.mark).toBeUndefined();
    expect(scene.direction).toBe("Mira finds the letter. Nobody speaks.");
    made.director.scenes = [];
    await made.director.whenLoaded();
    ok(await made.director.plan("Next.", { itemId: made.itemOf("Book/a.md"), placement: "append" }));
    expect(calls("/v1/plan").at(-1)?.body.tracking).toMatchObject({ pov: { version: 1, pages: {} }, timeline: { anchors: [], elapsed: [] } });
  });
  it("carries the last 20,000 characters, however long the chapter", async () => {
    const line = "A line of a long chapter that goes on for a while.\n";
    const made = await setup({ notes: { "Book/a.md": line.repeat(1_200) } });
    await drafted(made);
    expect((calls("/v1/plan")[0].body.precedingProse as string).length).toBe(20_000);
  });
  it("refuses a chapter it cannot place, before anything is paid", async () => {
    const made = await setup();
    const result = await made.director.plan("Direction.", { itemId: "gone", placement: "append" });
    expect(result).toEqual({ ok: false, failure: { kind: "input", message: "Open a chapter first: the scene goes into the chapter you are in." } });
    expect(engine!.directorCalls).toEqual([]);
  });
  it("a second click while one runs starts nothing", async () => {
    const made = await setup({ engine: { directorDelayMs: 20 } });
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const [first, second] = await Promise.all([made.director.plan("One.", anchor), made.director.plan("Two.", anchor)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(calls("/v1/plan").length).toBe(1);
  });
  it("two cards from one slug do not share a file, and a non-Latin direction still makes a file", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const [a, b] = [ok(await made.director.plan("Same.", anchor)), ok(await made.director.plan("Same.", anchor))];
    expect(a.sceneId).not.toBe(b.sceneId);
    const c = ok(await made.director.plan("ミラは手紙を見つける。", anchor));
    expect(c.sceneId).toMatch(/^[a-z0-9_-]+$/u);
    expect(c.title).toContain("ミラ");
    expect([...made.stored.keys()].filter((k) => k.endsWith(".json")).filter((k) => k.includes("/scenes/")).length).toBe(3);
  });
});

describe("what a failure says", () => {
  it("402 is out of credits, and nothing charged", async () => {
    const made = await setup({ engine: { balance: 10 } });
    const result = await made.director.plan("One.", { itemId: made.itemOf("Book/a.md"), placement: "append" });
    expect(result).toEqual({ ok: false, failure: { kind: "credits" } });
    expect(engine!.balance()).toBe(10);
  });
  it("a refund and a kept charge are the engine's own figures, and silence is not a refund", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    engine!.options.directorFail = { status: 500, charged: 0 };
    expect(await made.director.plan("A.", anchor)).toEqual({ ok: false, failure: { kind: "failed", charged: 0 } });
    engine!.options.directorFail = { status: 500, charged: 33 };
    expect(await made.director.plan("B.", anchor)).toEqual({ ok: false, failure: { kind: "failed", charged: 33 } });
    engine!.options.directorFail = { status: 503 };
    expect(await made.director.plan("C.", anchor)).toEqual({ ok: false, failure: { kind: "failed", charged: null } });
  });
  it("a lost answer retried carries the same key and pays once; a definite answer ends the attempt", async () => {
    const made = await setup({ engine: { directorLoseAnswer: true } });
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const lost = await made.director.plan("Retry me.", anchor);
    expect(lost).toEqual({ ok: false, failure: { kind: "failed", charged: null } });
    const before = engine!.balance();
    ok(await made.director.plan("Retry me.", anchor));
    const [first, second] = calls("/v1/plan");
    expect(second.key).toBe(first.key);
    expect(engine!.balance()).toBe(before);
    expect(engine!.directorCharged()).toBe(33);
    ok(await made.director.plan("Retry me.", anchor));
    expect(calls("/v1/plan")[2].key).not.toBe(first.key);
    // A failure with the engine's own figure is settled: the next press is a new attempt.
    engine!.options.directorFail = { status: 500, charged: 0, once: true };
    await made.director.plan("Again.", anchor);
    ok(await made.director.plan("Again.", anchor));
    expect(calls("/v1/plan")[4].key).not.toBe(calls("/v1/plan")[3].key);
  });
  it("a 5xx that names no charge keeps its key: the retry cannot start a second run, says so, and only the press after it starts a new charge", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    engine!.options.directorFail = { status: 503, once: true };
    expect(await made.director.plan("Ambiguous.", anchor)).toEqual({ ok: false, failure: { kind: "failed", charged: null } });
    const balance = engine!.balance();
    expect(await made.director.plan("Ambiguous.", anchor)).toEqual({ ok: false, failure: { kind: "failed", charged: null, replayed: true } });
    expect(engine!.balance()).toBe(balance);
    expect(calls("/v1/plan")[1].key).toBe(calls("/v1/plan")[0].key);
    ok(await made.director.plan("Ambiguous.", anchor));
    expect(calls("/v1/plan")[2].key).not.toBe(calls("/v1/plan")[0].key);
    expect(engine!.balance()).toBe(balance - 33);
  });
  it("an answer a card cannot be built from is a failure, not a card", async () => {
    const made = await setup();
    const engineAny = (made.director as unknown as { engine: { plan: unknown } }).engine;
    const { BadAnswerError } = await import("@/lib/services/director/directorService");
    engineAny.plan = () => Promise.reject(new BadAnswerError("no"));
    expect(await made.director.plan("X.", { itemId: made.itemOf("Book/a.md"), placement: "append" })).toEqual({ ok: false, failure: { kind: "failed", charged: null } });
  });
});

describe("the card", () => {
  it("hand edits are free, regenerating keeps one previous card, and the previous card is free", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const card = ok(await made.director.plan("One. Two. Three.", anchor));
    const spent = engine!.balance();
    const edited = ok(await made.director.editBeats(card.sceneId, [{ beatId: card.beats[1].beatId, intent: "Second, by hand." }, { beatId: card.beats[0].beatId, intent: card.beats[0].intent }, { intent: "Added." }]));
    expect(edited.beats.map((b) => b.intent)).toEqual(["Second, by hand.", card.beats[0].intent, "Added."]);
    expect(engine!.balance()).toBe(spent);
    const next = ok(await made.director.regenerate({ sceneId: card.sceneId, note: "colder", anchor }));
    expect(engine!.balance()).toBe(spent - 33);
    expect(next.note).toBe("colder");
    expect(calls("/v1/plan").at(-1)?.body.regenerate).toEqual({ note: "colder" });
    const back = ok(await made.director.swapPrevious(card.sceneId));
    expect(back.showingPrevious).toBe(true);
    expect(back.beats[0].intent).toBe("Second, by hand.");
    expect(engine!.balance()).toBe(spent - 33);
  });
  it("regenerating one beat changes that row, for one plan's price", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const card = ok(await made.director.plan("One. Two.", anchor));
    const next = ok(await made.director.regenerateBeat({ sceneId: card.sceneId, beatId: card.beats[1].beatId, note: "shorter", anchor }));
    expect(next.beats[1].intent).toBe("Regenerated beat 2.");
    expect(next.beats[0]).toEqual(card.beats[0]);
    expect(engine!.balance()).toBe(100_000 - 66);
  });
  it("an edit still open goes in with what is paid for", async () => {
    const made = await setup();
    const anchor = { itemId: made.itemOf("Book/a.md"), placement: "append" as const };
    const card = ok(await made.director.plan("One. Two.", anchor));
    const edits = [{ beatId: card.beats[0].beatId, intent: "Changed." }, { beatId: card.beats[1].beatId, intent: card.beats[1].intent }];
    ok(await made.director.write({ sceneId: card.sceneId, anchor, edits }));
    expect((calls("/v1/render/scene")[0].body.scene as { beats: { intent: string }[] }).beats[0].intent).toBe("Changed.");
    expect(engine!.balance()).toBe(100_000 - 33 - 2 * 67);
  });
  it("rewrites one passage, leading on, for one beat's price", async () => {
    const made = await setup();
    const scene = await drafted(made);
    const spent = engine!.balance();
    const next = ok(await made.director.rewriteBeat({ sceneId: scene.sceneId, beatId: scene.beats[0].beatId, beatOrder: 1, note: "quieter" }));
    expect(next.draft?.text.startsWith("Rewritten beat 1, leading on: quieter.")).toBe(true);
    expect(next.draft?.text).toContain(scene.draft!.text.slice(scene.draft!.spans[1].start, scene.draft!.spans[1].end));
    expect(engine!.balance()).toBe(spent - 67);
  });
  it("discard truly discards, and the card can be written again", async () => {
    const made = await setup();
    const scene = await drafted(made, "cursor");
    const next = ok(await made.director.discard(scene.sceneId));
    expect(next.draft).toBeUndefined();
    expect(next.mark).toBeUndefined();
    expect(next.beats.every((b) => b.renderedProse === undefined)).toBe(true);
  });
});

describe("Keep", () => {
  it("into an open note is one undo step, and the file is not touched behind it", async () => {
    const made = await setup();
    const editor = made.open("Book/a.md", 0);
    const scene = await drafted(made);
    const kept = await keep(made, scene.sceneId);
    expect(kept).toMatchObject({ ok: true, note: null });
    expect(editor.transactions).toBe(1);
    expect(made.processed).toEqual([]);
    expect(made.notes["Book/a.md"].startsWith("Mira came in.\nHer eyes were green.\n\nBeat 1 as prose")).toBe(true);
  });
  it("into a closed note goes through vault.process, and says there is no undo", async () => {
    const made = await setup();
    const scene = await drafted(made);
    const kept = await keep(made, scene.sceneId);
    expect(made.processed).toEqual(["Book/a.md"]);
    expect(kept).toMatchObject({ ok: true, note: "Chapter wasn't open for editing, so this went straight into the file, and Undo cannot take it back." });
    expect(made.notes["Book/a.md"]).toContain("Beat 3 as prose");
  });
  it("written with the cursor outside the chapter continues from the whole chapter, and goes to its end", async () => {
    const notes = { "Book/a.md": "# Notes\nResearch.\n# Two\nStory.\n# Three\nMore.\n" };
    const made = await setup({ notes, source: { kind: "note", path: "Book/a.md" } });
    made.open("Book/a.md", notes["Book/a.md"].indexOf("Research"));
    const { scan } = made.continuity;
    if (scan.status !== "ready") throw new Error("no scan");
    const two = scan.items.find((item) => item.label === "Two")!;
    const anchor = { itemId: two.id, placement: "cursor" as const };
    const card = ok(await made.director.plan("Into two.", anchor));
    expect(calls("/v1/plan")[0].body.precedingProse).toBe(two.text);
    const scene = ok(await made.director.write({ sceneId: card.sceneId, anchor }));
    expect(scene.mark).toBeUndefined();
    await keep(made, scene.sceneId);
    expect(notes["Book/a.md"]).toMatch(/^# Notes\nResearch\.\n# Two\nStory\.\n\nBeat 1[^#]*\n\n# Three\nMore\.\n$/u);
  });
  it("into a note in reading view goes through the file, whose editor nothing saves, and says there is no undo", async () => {
    const made = await setup();
    const editor = made.open("Book/a.md", 0);
    const scene = await drafted(made);
    editor.reading();
    const kept = await keep(made, scene.sceneId);
    expect(editor.transactions).toBe(0);
    expect(made.processed).toEqual(["Book/a.md"]);
    expect(kept).toMatchObject({ ok: true, note: "Chapter wasn't open for editing, so this went straight into the file, and Undo cannot take it back." });
  });
  it("at the cursor goes where it was written from, though the cursor has moved on", async () => {
    const made = await setup();
    const editor = made.open("Book/a.md", "Mira came in.".length);
    const scene = await drafted(made, "cursor");
    expect(calls("/v1/render/scene")[0].body.precedingProse).toBe("Mira came in.");
    editor.cursor = 0;
    await keep(made, scene.sceneId);
    expect(made.notes["Book/a.md"].startsWith("Mira came in.\n\nBeat 1 as prose")).toBe(true);
    expect(made.notes["Book/a.md"].endsWith("Her eyes were green.\n")).toBe(true);
  });
  it("at the cursor with the text before it changed goes to the end, with the desktop's line", async () => {
    const made = await setup();
    made.open("Book/a.md", "Mira came in.".length);
    const scene = await drafted(made, "cursor");
    made.notes["Book/a.md"] = `An opening line.\n${made.notes["Book/a.md"]}`;
    const kept = await keep(made, scene.sceneId);
    expect(kept).toMatchObject({ ok: true, note: "The chapter was reopened since this scene was written, so it went at the end of Chapter." });
    expect(made.notes["Book/a.md"].startsWith("An opening line.\nMira came in.\nHer eyes were green.\n\nBeat 1")).toBe(true);
  });
  it("twice at once places once; again after it is kept places nothing", async () => {
    const made = await setup();
    made.open("Book/a.md", 0);
    const scene = await drafted(made);
    const [first, second] = await Promise.all([keep(made, scene.sceneId), keep(made, scene.sceneId)]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(await keep(made, scene.sceneId)).toEqual({ ok: false, message: "" });
    expect(made.notes["Book/a.md"].split("Beat 1 as prose").length).toBe(2);
  });
  it("retried after the record failed records, and does not place again", async () => {
    let fail = false;
    const made = await setup({ failSceneWrite: () => fail });
    made.open("Book/a.md", 0);
    const scene = await drafted(made);
    fail = true;
    const first = await keep(made, scene.sceneId);
    expect(first).toEqual({ ok: false, message: "The scene is in Chapter, but Bunsho could not note that: disk" });
    fail = false;
    expect(await keep(made, scene.sceneId)).toMatchObject({ ok: true });
    expect(made.notes["Book/a.md"].split("Beat 1 as prose").length).toBe(2);
  });
  it("retried after a restart between the write and the record does not place again", async () => {
    let fail = false;
    const made = await setup({ failSceneWrite: () => fail });
    const scene = await drafted(made);
    fail = true;
    await keep(made, scene.sceneId);
    fail = false;
    const fresh = new DirectorController((made.continuity as unknown as { host: { app: never } }).host.app, made.continuity, () => undefined);
    await fresh.whenLoaded();
    expect(await fresh.keep(scene.sceneId, () => "Chapter")).toMatchObject({ ok: true, note: null });
    expect(made.notes["Book/a.md"].split("Beat 1 as prose").length).toBe(2);
  });
  it("in a note gone from the vault keeps the draft, and says nothing was placed", async () => {
    const made = await setup();
    const scene = await drafted(made);
    delete made.notes["Book/a.md"];
    expect(await keep(made, scene.sceneId)).toEqual({ ok: false, message: "Chapter is no longer in your vault. Nothing was placed." });
    expect(made.director.scenes[0].draft).toBeDefined();
  });
  it("opens the one-time check, and an older offer is let go", async () => {
    const made = await setup();
    const a = await drafted(made);
    const first = await keep(made, a.sceneId);
    expect(first.ok && first.scene.checkOffer).toBe(true);
    const b = await drafted(made, "append", "Book/b.md");
    await keep(made, b.sceneId);
    expect(made.director.scenes.find((s) => s.sceneId === a.sceneId)?.checkOffer).toBe(false);
    await made.director.dismissCheckOffer(b.sceneId);
    expect(made.director.scenes.find((s) => s.sceneId === b.sceneId)?.checkOffer).toBe(false);
  });
  it("keeps non-Latin prose as it came", async () => {
    const made = await setup({ engine: { directorProse: "彼女は振り返った。𠮷" }, notes: { "Book/a.md": "ミラは港に立った。\n" } });
    const scene = await drafted(made);
    await keep(made, scene.sceneId);
    expect(made.notes["Book/a.md"]).toBe("ミラは港に立った。\n\n彼女は振り返った。𠮷\n\n彼女は振り返った。𠮷\n\n彼女は振り返った。𠮷\n");
  });
  it("a file with CRLF keeps its line endings", async () => {
    const made = await setup({ notes: { "Book/a.md": "One.\r\nTwo.\r\n" } });
    const scene = await drafted(made);
    await keep(made, scene.sceneId);
    expect(made.notes["Book/a.md"].startsWith("One.\r\nTwo.\r\n\r\nBeat 1 as prose")).toBe(true);
    expect(made.notes["Book/a.md"].replace(/\r\n/gu, "").includes("\n")).toBe(false);
  });
});

describe("where scenes live", () => {
  it("one JSON per scene, reloaded as it was, and a damaged file is left alone with its name taken", async () => {
    const made = await setup();
    const scene = await drafted(made);
    const path = `plugins/bunsho/scenes/${scene.sceneId}.json`;
    expect(JSON.parse(made.stored.get(path)!)).toMatchObject({ sceneId: scene.sceneId, direction: scene.direction });
    made.stored.set("plugins/bunsho/scenes/sc_broken.json", "{not json");
    made.stored.set("plugins/bunsho/scenes/sc_wrong.json", JSON.stringify({ ...scene, sceneId: "sc_other" }));
    const fresh = new DirectorController((made.continuity as unknown as { host: { app: never } }).host.app, made.continuity, () => undefined);
    await fresh.whenLoaded();
    expect(fresh.scenes.map((s) => s.sceneId)).toEqual([scene.sceneId]);
    expect(fresh.scenes[0]).toEqual(scene);
    expect(made.stored.get("plugins/bunsho/scenes/sc_broken.json")).toBe("{not json");
  });
  it("one file that cannot be read hides nothing else, and its name stays taken", async () => {
    const made = await setup();
    const scene = await drafted(made);
    const app = (made.continuity as unknown as { host: { app: { vault: { adapter: { read: (path: string) => Promise<string> } } } } }).host.app;
    made.stored.set("plugins/bunsho/scenes/sc_unreadable.json", "x");
    const read = app.vault.adapter.read;
    app.vault.adapter.read = (path) => (path.includes("sc_unreadable") ? Promise.reject(new Error("locked")) : read(path));
    const fresh = new DirectorController(app as never, made.continuity, () => undefined);
    await fresh.whenLoaded();
    expect(fresh.scenes.map((s) => s.sceneId)).toEqual([scene.sceneId]);
    expect(made.stored.get("plugins/bunsho/scenes/sc_unreadable.json")).toBe("x");
    app.vault.adapter.read = read;
  });
  it("a kept scene lets go of the manuscript text its draft held", async () => {
    const made = await setup();
    const scene = await drafted(made);
    await keep(made, scene.sceneId);
    expect(JSON.stringify(JSON.parse(made.stored.get(`plugins/bunsho/scenes/${scene.sceneId}.json`)!))).not.toContain("precedingTail");
  });
  it("a write a crash interrupted is finished on the next read", async () => {
    const made = await setup();
    const scene = await drafted(made);
    const path = `plugins/bunsho/scenes/${scene.sceneId}.json`;
    made.stored.set(`${path}.tmp`, made.stored.get(path)!);
    made.stored.delete(path);
    const fresh = new DirectorController((made.continuity as unknown as { host: { app: never } }).host.app, made.continuity, () => undefined);
    await fresh.whenLoaded();
    expect(fresh.scenes.map((s) => s.sceneId)).toEqual([scene.sceneId]);
  });
  it("keeps the replaced version beside it", async () => {
    const made = await setup();
    const scene = await drafted(made);
    expect(made.stored.has(`plugins/bunsho/scenes/${scene.sceneId}.json.bak`)).toBe(true);
  });
  it("another account sees none of them; they return with the first; Delete my Bunsho data removes all", async () => {
    const made = await setup();
    await drafted(made);
    expect(made.director.scenes.length).toBe(1);
    await made.continuity.setDevUid("someone-else");
    await made.continuity.refreshAccount();
    made.director.ensureLoaded();
    await made.director.whenLoaded();
    expect(made.director.scenes).toEqual([]);
    made.continuity.data.source = { kind: "folder", path: "Book" };
    await made.continuity.editPlan();
    await drafted(made);
    expect([...made.stored.keys()].some((k) => k.includes("/accounts/") && k.includes("/scenes/"))).toBe(true);
    await made.continuity.setDevUid("test");
    await made.continuity.refreshAccount();
    made.director.ensureLoaded();
    await made.director.whenLoaded();
    expect(made.director.scenes.length).toBe(1);
    await made.continuity.deleteData();
    made.director.ensureLoaded();
    await made.director.whenLoaded();
    expect(made.director.scenes).toEqual([]);
    expect([...made.stored.keys()].filter((k) => k.includes("/scenes/"))).toEqual([]);
  });
  it("a paid answer arriving after Delete my Bunsho data writes nothing back", async () => {
    const made = await setup({ engine: { directorDelayMs: 30 } });
    const plan = made.director.plan("One.", { itemId: made.itemOf("Book/a.md"), placement: "append" });
    await new Promise((done) => setTimeout(done, 5));
    await made.continuity.deleteData();
    await plan;
    expect([...made.stored.keys()].filter((k) => k.includes("/scenes/"))).toEqual([]);
  });
  it("scenes of a note in another book do not show", async () => {
    const made = await setup({ notes: { "Book/a.md": "One.\n", "Other/x.md": "Two.\n" } });
    await drafted(made);
    expect(made.director.visibleScenes().length).toBe(1);
    made.continuity.data.source = { kind: "folder", path: "Other" };
    expect(made.director.visibleScenes()).toEqual([]);
  });
});
