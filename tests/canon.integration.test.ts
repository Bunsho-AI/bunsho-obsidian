/** Canon through the controller, against the mock engine's real protocol: what is stored where, what the wire carries, what is charged, and what may close a card. */
import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { ContinuityController, type PlanRequest } from "@/controllers/ContinuityController";
import { writerPinDigest } from "@/helpers/canon/pins";
import type { RecordEntity } from "@/helpers/canon/world";
import { readCanon } from "@/lib/obsidian/canonStore";
import type { PluginData } from "@/types";

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

const CANON = "Bunsho/canon.json";
const BOOK = () => ({ "Book/a.md": "Mira came in.\nHer eyes were green.", "Book/b.md": "Mira left.\nHer eyes were green still.", "Book/c.md": "Nobody came." });

async function setup(options: { notes?: Record<string, string>; failWrite?: () => boolean; stored?: Iterable<[string, string]>; data?: Record<string, unknown>; engine?: Parameters<typeof startMockEngine>[0] } = {}) {
  const notes: Record<string, string> = options.notes ?? BOOK();
  engine = await startMockEngine({ balance: 100_000, tickMs: 1, ...options.engine });
  const stored = new Map<string, string>(options.stored ?? []);
  const files = () => Object.keys(notes).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/u, ""), extension: "md" }));
  const app = {
    secretStorage: { getSecret: () => "", setSecret: () => undefined },
    vault: {
      getName: () => "Vault", getMarkdownFiles: files, getAllLoadedFiles: () => [],
      getFileByPath: (path: string) => (notes[path] === undefined ? null : { path }),
      getFolderByPath: (path: string) => (Object.keys(notes).some((n) => n.startsWith(`${path}/`)) ? { path } : null),
      adapter: {
        exists: (path: string) => Promise.resolve(stored.has(path) || [...stored.keys()].some((key) => key.startsWith(`${path}/`))),
        read: (path: string) => Promise.resolve(stored.get(path) ?? ""),
        write: (path: string, text: string) => { if (options.failWrite?.() && path.includes("canon")) return Promise.reject(new Error("disk")); stored.set(path, text); return Promise.resolve(); },
        remove: (path: string) => { stored.delete(path); return Promise.resolve(); },
        list: (path: string) => Promise.resolve({ files: [...stored.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")), folders: [] }),
        rename: (from: string, to: string) => { stored.set(to, stored.get(from) ?? ""); stored.delete(from); return Promise.resolve(); },
        mkdir: () => Promise.resolve(),
        rmdir: (path: string) => { for (const key of [...stored.keys()]) if (key.startsWith(`${path}/`)) stored.delete(key); return Promise.resolve(); },
      },
      read: (file: { path: string }) => Promise.resolve(notes[file.path]),
    },
    workspace: { getLeavesOfType: () => [], getActiveFile: () => null },
    metadataCache: { getFileCache: () => null },
  };
  let data: unknown = { engineUrl: `http://127.0.0.1:${engine.port}`, devUid: "test", source: { kind: "folder", path: "Book" }, workspaceId: "w", installId: "i", ...options.data };
  const controller = new ContinuityController({
    app: app as never, version: "0.1.0", dir: "plugins/bunsho", loadData: () => Promise.resolve(data), saveData: (next: PluginData) => { data = next; return Promise.resolve(); },
    openPanel: () => Promise.resolve(), changed: () => undefined, confirmCheck: () => Promise.resolve("check"),
    reviewPlan: (r: PlanRequest) => Promise.resolve({ kind: "plan", plan: { order: r.items.map((i) => i.id), excluded: [] } }),
    pickSource: () => Promise.resolve(null), pickIssue: () => Promise.resolve(null), confirmReplaceProject: () => Promise.resolve(true),
  });
  await controller.load();
  await controller.refreshAccount();
  await controller.editPlan();
  return { controller, notes, stored, app, data: () => data as PluginData };
}
async function checked(options: Parameters<typeof setup>[0] = {}) {
  const made = await setup(options);
  await made.controller.check();
  expect(made.controller.phase.kind).toBe("idle");
  return made;
}
const checking = async (c: ContinuityController) => { for (let i = 0; i < 2000 && c.phase.kind !== "checking"; i++) await new Promise((done) => setTimeout(done, 1)); expect(c.phase.kind).toBe("checking"); };
const mira = (c: ContinuityController): RecordEntity => c.worldRecord().find((e) => e.name === "Mira")!;
const rowOf = (entity: RecordEntity, label: string) => entity.rows.find((r) => r.label === label)!;
const pinEyes = async (c: ContinuityController) => { const entity = mira(c); const result = await c.makeCanon(entity.id, rowOf(entity, "Eye colour").id); expect(result.success).toBe(true); };
const declare = async (c: ContinuityController, value: string) => { const added = await c.addEntity("Odile", "character", []); if (!added.success) throw new Error(added.error); await c.addFact(added.data.entityId, "appearance:eye_color", null, value); return added.data.entityId; };

describe("where canon lives", () => {
  it("is canon.json in the plugin folder, beside world.json, and survives a restart", async () => {
    const { controller, stored, data } = await checked();
    await pinEyes(controller);
    expect(stored.has(CANON)).toBe(true);
    expect(stored.has("plugins/bunsho/world.json")).toBe(true);
    const again = await setup({ stored, data: data() as unknown as Record<string, unknown> });
    expect(rowOf(mira(again.controller), "Eye colour")).toMatchObject({ origin: "canon", value: "green", verb: "Revert" });
  });

  it("stays through sign-out, and Delete my Bunsho data removes it", async () => {
    const { controller, stored } = await checked();
    await pinEyes(controller);
    controller.data.devUid = "";
    await controller.signOut();
    expect(stored.has(CANON)).toBe(true);
    await controller.deleteData();
    expect(stored.has(CANON)).toBe(false);
    expect(controller.canonTracking().entities.entities).toEqual([]);
  });

  it("lives in the vault, not the plugin folder, so uninstalling the plugin leaves it", async () => {
    const { controller, stored } = await checked();
    await pinEyes(controller);
    expect([...stored.keys()].some((key) => key.startsWith("plugins/bunsho/") && key.includes("canon"))).toBe(false);
  });

  it("an earlier version's canon in the plugin folder moves to the vault at start, and reads as before", async () => {
    const { controller, stored, data } = await checked();
    await pinEyes(controller);
    const text = stored.get(CANON)!;
    stored.delete(CANON);
    stored.set("plugins/bunsho/canon.json", text);
    const again = await setup({ stored, data: data() as unknown as Record<string, unknown> });
    expect(again.stored.get(CANON)).toBe(text);
    expect(again.stored.has("plugins/bunsho/canon.json")).toBe(false);
    expect(rowOf(mira(again.controller), "Eye colour")).toMatchObject({ origin: "canon", value: "green" });
  });

  it("a canon already in the vault is never written over by the plugin folder's", async () => {
    const { controller, stored, data } = await checked();
    await pinEyes(controller);
    const vault = stored.get(CANON)!;
    stored.set("plugins/bunsho/canon.json", JSON.stringify({ version: 1, books: [] }));
    const again = await setup({ stored, data: data() as unknown as Record<string, unknown> });
    expect(again.stored.get(CANON)).toBe(vault);
    expect(again.stored.get("plugins/bunsho/canon.json")).toBe(JSON.stringify({ version: 1, books: [] }));
  });

  it("follows the folder when the writer renames it, and a hand-edited name outside the vault is not trusted", async () => {
    const { controller, stored, data } = await checked();
    await pinEyes(controller);
    const text = stored.get(CANON)!;
    stored.delete(CANON);
    stored.set("Writing/Bunsho/canon.json", text);
    await controller.moved("Writing/Bunsho", "Bunsho");
    expect(controller.data.dataFolder).toBe("Writing/Bunsho");
    await controller.addEntity("Someone", "character", []);
    expect(stored.get("Writing/Bunsho/canon.json")).toContain("Someone");
    expect(stored.has(CANON)).toBe(false);
    const hostile = await setup({ stored, data: { ...(data() as unknown as Record<string, unknown>), dataFolder: "../../elsewhere" } });
    expect(hostile.controller.data.dataFolder).toBe("Bunsho");
  });

  it("another account gets its own record, and the first's returns with it", async () => {
    const { controller, stored } = await checked();
    await pinEyes(controller);
    const first = stored.get(CANON);
    controller.data.devUid = "second";
    await controller.refresh();
    expect(controller.canonTracking().entities.entities).toEqual([]);
    controller.data.source = { kind: "folder", path: "Book" };
    await controller.refresh();
    await controller.addEntity("Someone", "character", []);
    expect(stored.get(CANON)).toBe(first);
    expect([...stored.keys()].some((key) => key.endsWith("canon.json") && key.includes("/accounts/"))).toBe(true);
    controller.data.devUid = "test";
    await controller.refresh();
    expect(controller.canonTracking().timeline.states).toHaveLength(1);
  });

  it("holds one book's record against that book alone, and follows it when the folder moves", async () => {
    const { controller } = await checked({ notes: { ...BOOK(), "Other/x.md": "Her eyes were blue." } });
    await pinEyes(controller);
    controller.data.source = { kind: "folder", path: "Other" };
    await controller.refresh();
    expect(controller.canonTracking().timeline.states).toEqual([]);
    controller.data.source = { kind: "folder", path: "Book" };
    await controller.moved("Novel", "Book");
    expect(controller.data.source.path).toBe("Novel");
    expect(controller.canonTracking().timeline.states).toHaveLength(1);
  });

  it("a write that fails is reported and leaves the record as it was", async () => {
    let fail = false;
    const { controller } = await checked({ failWrite: () => fail });
    fail = true;
    const entity = mira(controller);
    expect(await controller.makeCanon(entity.id, rowOf(entity, "Eye colour").id)).toMatchObject({ success: false, code: "INTERNAL_ERROR" });
    expect(controller.canonTracking().timeline.states).toEqual([]);
    expect(rowOf(mira(controller), "Eye colour").origin).toBe("found");
  });

  it("two writes at once both land", async () => {
    const { controller } = await setup();
    await Promise.all([controller.addEntity("Odile", "character", []), controller.addEntity("セルマ", "character", [])]);
    expect(controller.canonTracking().entities.entities.map((e) => e.canonicalName)).toEqual(["Odile", "セルマ"]);
  });

  it("a file it cannot read is kept, and no write or move can replace it", async () => {
    const { controller, stored } = await setup({ stored: [[CANON, "{not json"]] });
    expect(stored.get("Bunsho/canon.broken.json")).toBe("{not json");
    expect(controller.penOpen).toBe(false);
    expect(controller.canonProblem).toContain("canon.broken.json");
    expect(await controller.addEntity("Odile", "character", [])).toMatchObject({ success: false });
    await controller.moved("Novel", "Book");
    expect(stored.get(CANON)).toBe("{not json");
  });

  it("a newer version of the file is treated the same: it is not ours to overwrite", async () => {
    const raw = JSON.stringify({ version: 99, books: [] });
    const { controller, stored } = await setup({ stored: [[CANON, raw]] });
    expect(await controller.addEntity("Odile", "character", [])).toMatchObject({ success: false });
    expect(stored.get(CANON)).toBe(raw);
  });

  it("while canon cannot be read a check refuses before anything is spent, so no canon card is retired", async () => {
    const { controller, stored, data } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const cards = data().lastReview!.issues.length;
    stored.set(CANON, "{damaged by a sync conflict");
    await (controller as unknown as { loadCanon(): Promise<void> }).loadCanon();
    const starts = engine!.starts.length;
    await controller.check();
    expect(controller.phase).toMatchObject({ kind: "error", message: expect.stringContaining("could not read your canon") });
    expect(engine!.starts.length).toBe(starts);
    expect(data().lastReview!.issues).toHaveLength(cards);
    expect(controller.canonOffer()).toBeNull();
  });

  it("each damaged file gets its own copy, and the same one is not copied again", async () => {
    const first = await setup({ stored: [[CANON, "{one"]] });
    await engine!.close();
    const { stored } = await setup({ stored: [...first.stored, [CANON, "{two"]] });
    expect(stored.get("Bunsho/canon.broken.json")).toBe("{one");
    expect(stored.get("Bunsho/canon.broken-2.json")).toBe("{two");
    await engine!.close();
    const third = await setup({ stored });
    expect([...third.stored.keys()].filter((key) => key.includes("broken"))).toHaveLength(2);
    await third.controller.deleteData();
    expect([...third.stored.keys()].filter((key) => key.includes("canon"))).toEqual([]);
  });

  it("a rename while another account is signed in reaches the held account's data and canon", async () => {
    const { controller } = await checked();
    await pinEyes(controller);
    controller.data.devUid = "second";
    await controller.refresh();
    await controller.moved("Novel", "Book");
    controller.data.devUid = "test";
    await controller.refresh();
    expect(controller.data.source?.path).toBe("Novel");
    expect(controller.currentReview()).not.toBeNull();
    expect(controller.canonTracking().timeline.states).toHaveLength(1);
  });

  it("offline, a session is still known by the key remembered beside it, not by what data.json says", async () => {
    const { controller, app } = await checked();
    const owner = "e".repeat(24);
    (app as unknown as { secretStorage: { getSecret(id: string): string } }).secretStorage.getSecret = (id) => (id === "bunsho-session-owner" ? owner : "");
    controller.data.devUid = "";
    const tokens = (controller as unknown as { tokens: { idToken(): Promise<string>; signedIn(): Promise<boolean> } }).tokens;
    tokens.signedIn = () => Promise.resolve(true);
    tokens.idToken = () => Promise.reject(new Error("offline"));
    await controller.refreshAccount();
    expect(controller.data.accountKey).toBe(owner);
    expect(controller.currentReview()).toBeNull();
  });

  it("a write that fails takes back itself alone", async () => {
    let fail = false;
    const { controller } = await setup({ failWrite: () => fail });
    await controller.addEntity("Odile", "character", []);
    fail = true;
    const write = controller.addEntity("Selma", "character", []);
    fail = true;
    expect(await write).toMatchObject({ success: false });
    expect(controller.canonTracking().entities.entities.map((e) => e.canonicalName)).toEqual(["Odile"]);
  });

  it("keeps what it can of a damaged file, and a copy of the whole", async () => {
    const good = { source: { kind: "folder", path: "Book" }, tracking: { entities: { version: 1, entities: [{ entityId: "ent_a", canonicalName: "A", type: "character", aliases: [], status: "active", provenance: [] }] }, timeline: { version: 1, states: [null] }, knowledge: { version: 1, facts: [] } }, checked: null };
    const raw = JSON.stringify({ version: 1, books: [good, { source: 3 }] });
    const { controller, stored } = await setup({ stored: [[CANON, raw]] });
    expect(controller.canonTracking().entities.entities.map((e) => e.canonicalName)).toEqual(["A"]);
    expect(stored.get("Bunsho/canon.broken.json")).toBe(raw);
  });

  it("finishes a write a crash interrupted", async () => {
    const seen = new Map([[`${CANON}.tmp`, JSON.stringify({ version: 1, books: [] })]]);
    const read = await readCanon({ vault: { adapter: { exists: (p: string) => Promise.resolve(seen.has(p)), read: (p: string) => Promise.resolve(seen.get(p)!) } } } as never, "plugins/bunsho");
    expect(read).toEqual({ books: [], damaged: false, unreadable: false });
  });

  it("a file that cannot be read at all rests the pen, so nothing can replace it", async () => {
    const { controller, app, stored } = await setup({ stored: [[CANON, "{}"]] });
    (app.vault.adapter as { read: (p: string) => Promise<string> }).read = () => Promise.reject(new Error("locked"));
    await (controller as unknown as { loadCanon(): Promise<void> }).loadCanon();
    expect(controller.penOpen).toBe(false);
    expect(await controller.addEntity("Odile", "character", [])).toMatchObject({ success: false, code: "INTERNAL_ERROR" });
    expect(stored.get(CANON)).toBe("{}");
  });
});

describe("pins on the wire", () => {
  it("every review carries the active pins, in the engine's strict shape; knowledge and dynamic facts stay silent", async () => {
    const { controller } = await checked();
    const id = await declare(controller, "grey");
    await controller.addFact(id, "location", null, "the quay");
    await controller.addFact(id, "knows", null, "the deed is forged");
    await controller.check();
    const start = engine!.starts.at(-1)!;
    expect(start.pins).toEqual([{ pinId: expect.stringMatching(/^st_/u), entityId: id, entityName: "Odile", aliases: [], dimension: "appearance:eye_color", value: "grey", declaredAt: expect.any(String) }]);
  });

  it("before any pin the wire is as it was", async () => {
    await checked();
    expect(engine!.starts.at(-1)!.pins).toEqual([]);
  });

  it("a pinned found fact goes with the cast's name, under an id of the record's own", async () => {
    const { controller } = await checked();
    await pinEyes(controller);
    await controller.check();
    const [pin] = engine!.starts.at(-1)!.pins;
    expect(pin).toMatchObject({ entityName: "Mira", dimension: "appearance:eye_color", value: "green" });
    expect(pin.entityId).toMatch(/^ent_[0-9a-f]{8}-/u);
    expect(pin.entityId).not.toBe(mira(controller).id);
  });

  it("past the engine's 200 pins it says so before anything is spent", async () => {
    const { controller } = await checked();
    const added = await controller.addEntity("Odile", "character", []);
    if (!added.success) throw new Error(added.error);
    for (let i = 0; i < 201; i++) await controller.addFact(added.data.entityId, "trait", null, `t${i}`);
    const starts = engine!.starts.length;
    await controller.check();
    expect(controller.phase).toMatchObject({ kind: "error", message: expect.stringContaining("up to 200 declared facts") });
    expect(engine!.starts.length).toBe(starts);
    expect(controller.canonOffer()).toBeNull();
  });
});

describe("Check canon", () => {
  it("is hidden until the book has been read, and until there is a pin", async () => {
    const { controller } = await setup();
    await declare(controller, "grey");
    expect(controller.canonOffer()).toBeNull();
    await controller.check();
    expect(controller.canonOffer()).toBeNull(); // the whole book was just checked against this canon
  });

  it("appears when the canon changes after a full review, at the engine's price, and nothing else does", async () => {
    const { controller } = await checked();
    expect(controller.canonOffer()).toBeNull();
    await declare(controller, "grey");
    const chars = Object.values(BOOK()).join("").length;
    expect(chars).toBeLessThan(3000);
    expect(controller.canonOffer()).toEqual({ pins: 1, credits: 3 + 2 });
    expect(controller.changedChapters()).toBeNull(); // a pin edit makes no chapter pending
  });

  it("is hidden when a chapter's read no longer stands, and comes back once it does", async () => {
    const { controller, notes } = await checked();
    await declare(controller, "grey");
    notes["Book/c.md"] = "Someone else came.";
    await controller.refreshScan();
    expect(controller.canonOffer()).toBeNull();
    const changed = controller.changedChapters()!;
    await controller.reviewChanged(changed.credits);
    expect(controller.canonOffer()).not.toBeNull();
  });

  it("sends every chapter whole, with its read's cast and no facts, and the pins; reads nothing, marks nothing, leaves the cast", async () => {
    const { controller, stored, data } = await checked();
    await pinEyes(controller);
    const worldBefore = stored.get("plugins/bunsho/world.json");
    const ledgerBefore = data().lastReview!.ledger;
    const issuesBefore = data().lastReview!.issues.map((i) => i.issue_id);
    const offer = await (async () => { await declare(controller, "grey"); return controller.canonOffer()!; })();
    await controller.checkCanon(offer.credits);
    const start = engine!.starts.at(-1)!;
    expect(start.scope).toBe("canon");
    expect(start.maxCredits).toBe(offer.credits);
    expect(start.pages.every((p) => p.send === "whole")).toBe(true);
    expect(start.cachedReads).toHaveLength(3);
    expect(start.cachedReads.every((read) => read.facts.length === 0)).toBe(true);
    expect(start.pins).toHaveLength(2);
    expect(stored.get("plugins/bunsho/world.json")).toBe(worldBefore);
    expect(data().lastReview!.ledger).toEqual(ledgerBefore);
    expect(data().lastReview!.issues.map((i) => i.issue_id)).toEqual(issuesBefore);
    expect(controller.canonOffer()).toBeNull();
    expect(controller.phase.kind).toBe("idle");
  });

  it("charges the engine's canon price, and the engine and the quote agree", async () => {
    const { controller } = await checked({ engine: { enforce: true } });
    await declare(controller, "grey");
    const before = engine!.balance();
    const { credits } = controller.canonOffer()!;
    await controller.checkCanon(credits);
    expect(before - engine!.balance()).toBe(credits);
  });

  it("stores a conflict as a card, and a pass that no longer finds it retires it, and nothing else", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.\nThe boat was red.", "Book/b.md": "The boat was blue." } });
    const boat = controller.currentReview()!.issues.map((i) => i.issue_id);
    expect(boat).toHaveLength(1);
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    const quoted = controller.canonOffer()!.credits;
    await controller.checkCanon(quoted);
    const card = controller.currentReview()!.issues.find((i) => i.type === "canon_conflict")!;
    expect(card.citations[0].quoted_text).toContain("green");
    const view = controller.canonConflict(card)!;
    expect(view).toMatchObject({ title: "Ch. 1 contradicts canon", coordinate: "a", factLabel: "Eye colour", pinned: true, factId: "Mira · eye colour" });
    expect(view.context.pinnedValue).toBe("grey");
    expect(view.mark).toMatch(/^canon · you · /u);

    // Fixed in the prose: the next pass finds nothing, and only the canon card goes.
    notes["Book/a.md"] = "Her eyes were grey.\nThe boat was red.";
    await controller.refreshScan();
    await controller.reviewChanged(controller.changedChapters()!.credits);
    await controller.editFact(rowOf(mira(controller), "Eye colour").target!, { value: "hazel" }).catch(() => undefined);
    const next = controller.canonOffer();
    expect(next).not.toBeNull();
    engine!.options.findNothing = true;
    await controller.checkCanon(next!.credits);
    expect(controller.currentReview()!.issues.filter((i) => i.type === "canon_conflict")).toEqual([]);
    expect(controller.currentReview()!.issues.map((i) => i.issue_id)).toEqual(expect.arrayContaining(boat));
  });

  it("a re-found conflict keeps its card", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green today.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    notes["Book/a.md"] = "Her eyes were green today, she said.";
    await controller.refreshScan();
    await controller.reviewChanged(controller.changedChapters()!.credits);
    const after = controller.currentReview()!.issues.filter((i) => i.type === "canon_conflict");
    expect(after.map((i) => i.issue_id)).toEqual([card.issue_id]);
  });

  it("proves nothing when the book changed during the pass, or the search fell short: nothing retired, offer stands", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    expect(controller.currentReview()!.issues).toHaveLength(1);

    await controller.editFact(rowOf(mira(controller), "Eye colour").target!, { value: "hazel" });
    engine!.options.findNothing = true;
    engine!.options.skipped = 2;
    await controller.checkCanon(controller.canonOffer()!.credits);
    expect(controller.currentReview()!.issues).toHaveLength(1);
    expect(controller.phase).toMatchObject({ kind: "error", charged: true, action: { kind: "canon" } });
    expect(controller.canonOffer()).not.toBeNull();
    expect(controller.retryQuote()).toBe(controller.canonOffer()!.credits);

    engine!.options.skipped = 0;
    const run = controller.retry();
    await checking(controller);
    notes["Book/b.md"] = "Edited while it ran.";
    await run;
    expect(controller.currentReview()!.issues).toHaveLength(1);
    expect(controller.phase).toMatchObject({ kind: "error", message: expect.stringContaining("changed during the canon check") });
  });

  it("stops uncharged when a read will not go, saying what to do", async () => {
    const { controller, notes } = await checked();
    await declare(controller, "grey");
    const quoted = controller.canonOffer()!.credits;
    notes["Book/c.md"] = "Edited after the button was drawn.";
    await controller.refreshScan();
    const starts = engine!.starts.length;
    await controller.checkCanon(quoted);
    expect(engine!.starts.length).toBe(starts);
    expect(controller.phase).toMatchObject({ kind: "error", charged: false, message: expect.stringContaining("Review the changed chapters first") });
  });

  it("refuses more than the price on the button", async () => {
    const { controller } = await checked();
    await declare(controller, "grey");
    const starts = engine!.starts.length;
    await controller.checkCanon(1);
    expect(engine!.starts.length).toBe(starts);
    expect(controller.phase).toMatchObject({ kind: "error" });
    expect((controller.phase as { message: string }).message).toContain("more than the 1 you confirmed");
  });

  it("out of credits says so, and leaves no stopped review behind", async () => {
    const { controller } = await checked({ engine: { enforce: true } });
    await declare(controller, "grey");
    const { credits } = controller.canonOffer()!;
    await fetch(`http://127.0.0.1:${engine!.port}/__mock`, { method: "POST", body: JSON.stringify({ balance: credits - 1 }) });
    await controller.refreshAccount();
    await controller.checkCanon(credits);
    expect(controller.phase.kind).toBe("error");
    expect((controller.phase as { message: string }).message).toContain("credits");
    expect(controller.data.stopped).toBeNull();
  });
});

describe("a full review and the offer", () => {
  it("a finished full review records the pins it carried, and a capped one does not", async () => {
    const { controller, data, stored } = await checked();
    await declare(controller, "grey");
    expect(controller.canonOffer()).not.toBeNull();
    engine!.options.capped = true;
    await controller.check();
    expect(controller.canonOffer()).not.toBeNull();
    engine!.options.capped = false;
    await controller.check();
    expect(controller.canonOffer()).toBeNull();
    const books = (JSON.parse(stored.get(CANON)!) as { books: { checked: { pinDigest: string } }[] }).books;
    expect(books[0].checked.pinDigest).toBe(writerPinDigest(controller.canonTracking()));
    expect(data().lastReview).not.toBeNull();
  });

  it("a chapter check does not stand for the whole book", async () => {
    const { controller, notes } = await checked();
    await declare(controller, "grey");
    notes["Book/c.md"] = "Changed.";
    await controller.refreshScan();
    await controller.reviewChanged(controller.changedChapters()!.credits);
    expect(controller.canonOffer()).not.toBeNull();
  });
});

describe("prune, and Check if fixed", () => {
  it("a sweep retires a canon card whose pin was reverted or edited", async () => {
    const { controller, data } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    expect(data().lastReview!.issues).toHaveLength(1);
    const { target } = rowOf(mira(controller), "Eye colour");
    await controller.revertFact(target!);
    engine!.options.findNothing = true;
    await controller.check();
    expect(data().lastReview!.issues).toEqual([]);
  });

  it("a successful Revert leaves the card until the next check, with nothing left to revert", async () => {
    const { controller } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    const before = controller.canonConflict(card)!;
    expect(before.pinned).toBe(true);
    expect(await controller.revertFact(before.target)).toMatchObject({ success: true });
    expect(controller.currentReview()!.issues).toHaveLength(1);
    expect(controller.canonConflict(card)!.pinned).toBe(false);
    expect(await controller.revertFact(before.target)).toMatchObject({ success: false, code: "STALE_TARGET" });
  });

  it("Check if fixed will not close a card when the pins moved while it ran", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    notes["Book/a.md"] = "Her eyes were grey.";
    await controller.refreshScan();
    const quote = controller.recheckQuote(card.issue_id)!;
    const run = controller.recheck(card.issue_id, quote);
    await checking(controller);
    await controller.addFact(mira(controller).id, "appearance:hair", null, "black");
    const result = await run;
    expect(result.kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("Check if fixed will not close a card whose pin was reverted: nothing was checked against it", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    await controller.revertFact(controller.canonConflict(card)!.target);
    notes["Book/a.md"] = "Her eyes were green, she said.";
    await controller.refreshScan();
    expect((await controller.recheck(card.issue_id, controller.recheckQuote(card.issue_id)!)).kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("Check if fixed will not close a card when a search was skipped", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    notes["Book/a.md"] = "Her eyes were grey.";
    await controller.refreshScan();
    engine!.options.skipped = 1;
    expect((await controller.recheck(card.issue_id, controller.recheckQuote(card.issue_id)!)).kind).toBe("complete");
    expect(controller.data.fixed).toEqual([]);
  });

  it("a full review whose searches fell short does not stand for the canon", async () => {
    const { controller } = await checked();
    await declare(controller, "grey");
    engine!.options.skipped = 1;
    await controller.check();
    expect(controller.canonOffer()).not.toBeNull();
  });

  it("a rename during Check canon keeps the findings, and the pass is recorded", async () => {
    const { controller } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "green");
    await controller.addFact(mira(controller).id, "voice", null, "low");
    const run = controller.checkCanon(controller.canonOffer()!.credits);
    await checking(controller);
    await controller.moved("Novel", "Book");
    await run;
    expect(controller.data.source?.path).toBe("Novel");
    expect(controller.currentReview()).not.toBeNull();
  });

  it("Check if fixed closes it when the fix is in the prose and the pins held", async () => {
    const { controller, notes } = await checked({ notes: { "Book/a.md": "Her eyes were green.", "Book/b.md": "Nothing." } });
    await controller.addFact(mira(controller).id, "appearance:eye_color", null, "grey");
    await controller.checkCanon(controller.canonOffer()!.credits);
    const [card] = controller.currentReview()!.issues;
    notes["Book/a.md"] = "Her eyes were grey.";
    await controller.refreshScan();
    const result = await controller.recheck(card.issue_id, controller.recheckQuote(card.issue_id)!);
    expect(result.kind).toBe("closed");
    expect(controller.data.fixed).toEqual([card.issue_id]);
  });
});

describe("who may write", () => {
  it("a Free account's first declaration makes this vault its one project", async () => {
    const { controller } = await setup();
    expect(controller.account.project).toBe("unregistered");
    await controller.addEntity("Odile", "character", []);
    expect(engine!.registration()).toMatchObject({ workspaceId: "w", name: "Vault" });
    expect(controller.account.project).toBe("ok");
  });

  it("a plan that ended rests the pen on a fresh read; canon still reads and nothing is lost", async () => {
    const { controller, stored } = await checked({ engine: { paid: true, tier: "storyteller", renewsAt: "2026-03-12T00:00:00.000Z" } });
    await pinEyes(controller);
    const file = stored.get(CANON);
    expect(controller.penOpen).toBe(true);
    engine!.options.paid = false;
    await controller.refreshAccount();
    expect(controller.account.lapsed).toEqual({ plan: "Storyteller", endedAt: "2026-03-12T00:00:00.000Z" });
    expect(controller.penOpen).toBe(false);
    expect(await controller.addEntity("Odile", "character", [])).toMatchObject({ success: false });
    expect(stored.get(CANON)).toBe(file);
    expect(rowOf(mira(controller), "Eye colour").origin).toBe("canon");
    engine!.options.paid = true;
    await controller.refreshAccount();
    expect(controller.penOpen).toBe(true);
  });

  it("a subscription read that failed is no evidence a plan ended", async () => {
    const { controller } = await checked({ engine: { paid: true, tier: "saga" } });
    engine!.options.paid = false;
    engine!.options.subscriptionDown = true;
    await controller.refreshAccount();
    expect(controller.account.lapsed).toBeNull();
    expect(controller.penOpen).toBe(true);
  });

  it("someone who never paid is not told a plan ended", async () => {
    const { controller } = await setup();
    expect(controller.account.lapsed).toBeNull();
  });
});

describe("the pen through the World", () => {
  it("Make canon then Revert brings the found row back, passage and all", async () => {
    const { controller } = await checked();
    await pinEyes(controller);
    const canon = rowOf(mira(controller), "Eye colour");
    expect(canon).toMatchObject({ origin: "canon", verb: "Revert", mark: "canon · you · from a" });
    await controller.revertFact(canon.target!);
    expect(rowOf(mira(controller), "Eye colour")).toMatchObject({ origin: "found", verb: "Make canon", value: "green" });
  });

  it("a row gone since it was shown is refused, not pinned", async () => {
    const { controller } = await checked();
    expect(await controller.makeCanon(mira(controller).id, "gone")).toMatchObject({ success: false, code: "STALE_TARGET", error: "That fact changed since it was shown — reloading" });
    expect(await controller.makeCanon("nobody", "gone")).toMatchObject({ success: false, code: "STALE_TARGET" });
  });

  it("typing what a check already found pins it, keeping its page", async () => {
    const { controller } = await checked();
    const result = await controller.addFact(mira(controller).id, "appearance:eye_color", null, "GREEN");
    expect(result).toMatchObject({ success: true, data: { outcome: "pinned" } });
    expect(rowOf(mira(controller), "Eye colour").verb).toBe("Revert");
  });

  it("a relationship with someone found uses record ids on both sides, and a topic its key", async () => {
    const { controller } = await checked({ notes: { "Book/a.md": "Her eyes were green. The Salt Guild met.", "Book/b.md": "Nothing." } });
    const guild = controller.worldRecord().find((e) => e.name.includes("Guild"))!;
    await controller.addFact(mira(controller).id, "relationship", guild.id, "member of");
    await controller.addFact(mira(controller).id, "stance", "The Deed", "against");
    const dims = controller.canonTracking().timeline.states.map((s) => s.dimension);
    expect(dims[0]).toMatch(/^relationship:ent_/u);
    expect(dims[1]).toBe("stance:the_deed");
    expect(mira(controller).rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Relationship with The Salt Guild", "Stance on the deed"]));
    expect(await controller.addFact(mira(controller).id, "relationship", null, "x")).toMatchObject({ code: "INVALID_INPUT" });
    expect(await controller.addFact("nobody", "voice", null, "x")).toMatchObject({ code: "NOT_FOUND" });
  });

  it("knowledge typed by hand reads back, and is never a pin", async () => {
    const { controller } = await checked();
    await controller.addFact(mira(controller).id, "knows", null, "港の権利書は偽物だ");
    expect(rowOf(mira(controller), "Knows")).toMatchObject({ origin: "canon", value: "港の権利書は偽物だ", verb: "Edit" });
    await controller.check();
    expect(engine!.starts.at(-1)!.pins).toEqual([]);
  });

  it("a hand-added person listed before any check, renamed, aliased and removed", async () => {
    const { controller } = await setup();
    expect(controller.worldRecord()).toEqual([]);
    const added = await controller.addEntity("ミラ", "character", ["ミラちゃん"]);
    if (!added.success) throw new Error(added.error);
    const [card] = controller.worldRecord();
    expect(card).toMatchObject({ name: "ミラ", aliases: ["ミラちゃん"], type: "character", writerTouched: true, scenes: 0 });
    await controller.renameEntity(card.id, "ミラ・ヴェイル");
    await controller.addAlias(card.id, "ヴェイル");
    expect(controller.worldRecord()[0]).toMatchObject({ name: "ミラ・ヴェイル", aliases: ["ミラちゃん", "ミラ", "ヴェイル"] });
    expect(await controller.removeEntity(card.id)).toMatchObject({ success: true });
    expect(controller.worldRecord()).toEqual([]);
  });

  it("someone a check found cannot be removed, and answers with their pages", async () => {
    const { controller } = await checked();
    await controller.renameEntity(mira(controller).id, "Mira Vale");
    const entity = controller.worldRecord().find((e) => e.name === "Mira Vale")!;
    expect(await controller.removeEntity(entity.canonId!)).toMatchObject({ success: false, code: "ENTITY_IN_USE", data: { pages: 2 } });
  });

  it("the identity prompt asks about someone found, and linking brings them into the record", async () => {
    const { controller } = await checked();
    const asked = await controller.addEntity("mira", "character", []);
    if (asked.success || !asked.match) throw new Error("expected a question");
    expect(asked).toMatchObject({ code: "IDENTITY_AMBIGUOUS", match: { canonicalName: "Mira", type: "character", sample: { quote: expect.any(String) } } });
    const linked = await controller.addEntity("Mira V", "character", [], "alias_of_existing", asked.match.ref);
    expect(linked).toMatchObject({ success: true, data: { outcome: "aliased" } });
    expect(mira(controller).aliases).toContain("Mira V");
  });
});
