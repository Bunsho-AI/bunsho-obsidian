/** The money path, against a real protocol engine: what is sent and charged is what the writer was shown. */
import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { ContinuityController, type CheckAnswer, type ControllerHost, type PlanAnswer, type PlanRequest } from "@/controllers/ContinuityController";
import type { SourceChoice } from "@/helpers/sources";
import type { PluginData } from "@/types";

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

const FOLDER: SourceChoice = { kind: "folder", path: "Book" };
const planOf = (r: PlanRequest, excluded: string[] = []): PlanAnswer => ({ kind: "plan", plan: { order: r.items.map((i) => i.id), excluded } });

interface Setup {
  notes: Record<string, string>;
  host?: Partial<ControllerHost>;
  read?: (path: string, text: string) => Promise<string>;
  world?: Iterable<[string, string]>;
  data?: Record<string, unknown>;
  failWrite?: boolean;
}

async function setup({ notes, host = {}, read, world = [], data: savedData = {}, failWrite = false }: Setup) {
  engine = await startMockEngine({ balance: 100_000 });
  const files = () => Object.keys(notes).map((path) => ({ path, basename: path.split("/").pop()!.replace(/\.md$/u, ""), extension: "md" }));
  const stored = new Map<string, string>(world);
  const app = {
    secretStorage: { getSecret: () => "", setSecret: () => undefined },
    vault: {
      getName: () => "Vault", getMarkdownFiles: files, getAllLoadedFiles: () => [],
      getFileByPath: (path: string) => (notes[path] === undefined ? null : { path }),
      getFolderByPath: (path: string) => (Object.keys(notes).some((n) => n.startsWith(`${path}/`)) ? { path } : null),
      adapter: {
        exists: (path: string) => Promise.resolve(stored.has(path)),
        read: (path: string) => Promise.resolve(stored.get(path) ?? ""),
        write: (path: string, text: string) => { if (failWrite) return Promise.reject(new Error("disk")); stored.set(path, text); return Promise.resolve(); },
        remove: (path: string) => { stored.delete(path); return Promise.resolve(); },
      },
      read: (file: { path: string }) => (read ? read(file.path, notes[file.path]) : Promise.resolve(notes[file.path])),
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: { getFileCache: () => null },
  };
  const saved: PluginData[] = [];
  let data: unknown = { engineUrl: `http://127.0.0.1:${engine.port}`, devUid: "test", source: FOLDER, workspaceId: "w", installId: "i", ...savedData };
  const controller = new ContinuityController({
    app: app as never, version: "0.1.0", dir: "plugins/bunsho", loadData: () => Promise.resolve(data),
    saveData: (next) => { data = next; saved.push(next); return Promise.resolve(); },
    openPanel: () => Promise.resolve(), changed: () => undefined,
    confirmCheck: (): Promise<CheckAnswer> => Promise.resolve("check"),
    reviewPlan: (r) => Promise.resolve(planOf(r)),
    pickSource: () => Promise.resolve(null),
    confirmReplaceProject: () => Promise.resolve(true),
    ...host,
  });
  await controller.load();
  return { controller, saved, notes, stored, data: () => data };
}

/** Confirms a plan first, so the next check goes straight to the price. */
async function withConfirmedPlan(controller: ContinuityController) {
  await controller.refreshAccount();
  await controller.editPlan();
  expect(controller.phase.kind).toBe("idle");
}

const sentText = () => engine!.sentPages.map((p) => p.text).join("\n");
const longer = "A later edit that makes this note much longer. ".repeat(100);

describe("what is sent is what the writer was shown", () => {
  it("edits made while the price dialog is open wait for the next check, at the price shown", async () => {
    const notes = { "Book/a.md": "Her eyes were green.", "Book/b.md": "Her eyes were brown." };
    let shown: number | null = null;
    const { controller } = await setup({ notes, host: { confirmCheck: async (quote) => {
      shown = quote.credits;
      notes["Book/a.md"] += longer; // autosave while the dialog is open
      await controller.refreshScan();
      return "check";
    } } });
    await withConfirmedPlan(controller);
    await controller.check();
    expect(controller.phase.kind).toBe("idle");
    expect(sentText()).not.toContain("later edit");
    expect(engine!.starts[0].maxCredits).toBe(shown);
    expect(shown).not.toBeNull();
  });

  it("a note created while the price dialog is open is not sent", async () => {
    const notes: Record<string, string> = { "Book/a.md": "One.", "Book/b.md": "Two." };
    const { controller } = await setup({ notes, host: { confirmCheck: async () => {
      notes["Book/new.md"] = "Private scene nobody has seen on the plan.";
      await controller.refreshScan();
      return "check";
    } } });
    await withConfirmedPlan(controller);
    await controller.check();
    expect(sentText()).not.toContain("Private scene");
    expect(controller.scan.status === "ready" && controller.scan.needsConfirming).toBe(true);
  });

  it("an unticked note is never sent, even when another scan overtakes the one after the plan", async () => {
    const notes = { "Book/a.md": "Story.", "Book/research.md": "Secret research." };
    const { controller } = await setup({
      notes,
      read: async (_path, text) => { await new Promise((done) => setTimeout(done, 15)); return text; },
      host: { reviewPlan: (r) => {
        void controller.refreshScan(); // a scheduled scan, already running as the plan closes
        return Promise.resolve(planOf(r, r.items.filter((i) => i.label === "research").map((i) => i.id)));
      } },
    });
    await controller.check();
    expect(controller.phase.kind).toBe("idle");
    expect(sentText()).toContain("Story.");
    expect(sentText()).not.toContain("Secret research");
    expect(engine!.starts[0].pages).toHaveLength(1);
  });

  it("charges the plan screen's price for the ticked notes only", async () => {
    const notes = { "Book/a.md": "x".repeat(4000), "Book/b.md": "y".repeat(4000) };
    let shown: number | null = null;
    const { controller } = await setup({ notes, host: { reviewPlan: (r) => {
      shown = r.priceFor(4000);
      return Promise.resolve(planOf(r, [r.items[1].id]));
    } } });
    await controller.check();
    expect(engine!.starts[0].maxCredits).toBe(shown);
  });
});

describe("one review at a time", () => {
  it("refuses to change the source during a review, and the review can still be cancelled", async () => {
    const notes = { "Book/a.md": "One." };
    let picked = false;
    const { controller } = await setup({ notes, host: { pickSource: () => { picked = true; return Promise.resolve(null); } } });
    await withConfirmedPlan(controller);
    const run = controller.check();
    while (controller.phase.kind !== "checking") await new Promise((done) => setTimeout(done, 5));
    await controller.chooseSource();
    await controller.editPlan();
    expect(picked).toBe(false);
    expect(controller.phase.kind).toBe("checking");
    controller.cancel();
    await run;
    expect(controller.phase.kind).toBe("idle");
    expect(engine!.starts).toHaveLength(1);
  });
});

describe("renames", () => {
  it("keeps a review's findings visible when the book's folder is renamed while it runs", async () => {
    const notes: Record<string, string> = { "Book/a.md": "Her eyes were green.", "Book/b.md": "Her eyes were brown." };
    const { controller } = await setup({ notes });
    await withConfirmedPlan(controller);
    const run = controller.check();
    while (controller.phase.kind !== "checking") await new Promise((done) => setTimeout(done, 5));
    await controller.moved("Novel", "Book");
    await run;
    expect(controller.data.source?.path).toBe("Novel");
    expect(controller.currentReview()?.issues).toHaveLength(1);
  });

  it("does not write anything for a rename outside the book", async () => {
    const { controller, saved } = await setup({ notes: { "Book/a.md": "One." } });
    await controller.refreshScan();
    const before = saved.length;
    await controller.moved("Elsewhere/new.md", "Elsewhere/old.md");
    expect(saved).toHaveLength(before);
  });

  it("treats a new note at a deleted note's path as new, so the plan is shown", async () => {
    const notes = { "Book/a.md": "One." };
    const { controller } = await setup({ notes });
    await withConfirmedPlan(controller);
    await controller.deleted("Book/a.md");
    await controller.refreshScan();
    expect(controller.scan.status === "ready" && controller.scan.needsConfirming).toBe(true);
  });
});

describe("recovery", () => {
  it("leaves no stuck state when the notes cannot be read", async () => {
    const { controller } = await setup({ notes: { "Book/a.md": "One." }, read: () => Promise.reject(new Error("The note could not be read.")) });
    await controller.editPlan();
    expect(controller.phase).toMatchObject({ kind: "error", message: "The note could not be read." });
    await controller.refreshScan(); // a scheduled scan warns and keeps the last result
    await controller.chooseSource();
    expect(controller.phase.kind).toBe("idle");
    await controller.check();
    expect(controller.phase.kind).toBe("error");
  });

  it("leaves no stuck state when the plan screen fails", async () => {
    const { controller } = await setup({ notes: { "Book/a.md": "One." }, host: { reviewPlan: () => Promise.reject(new Error("boom")) } });
    await controller.editPlan();
    expect(controller.phase).toMatchObject({ kind: "error", message: "boom" });
  });

  it("returns to idle when the writer closes the plan without confirming", async () => {
    const { controller } = await setup({ notes: { "Book/a.md": "One." }, host: { reviewPlan: () => Promise.resolve(null) } });
    await controller.editPlan();
    expect(controller.phase.kind).toBe("idle");
    await controller.check();
    expect(controller.phase.kind).toBe("idle");
    expect(engine!.starts).toHaveLength(0);
  });
});

describe("the World tab", () => {
  const BOOK = { "Book/a.md": "Her eyes were green.", "Book/b.md": "Her eyes were brown." };

  it("fills from the check, with no second charge, and keeps the first value of what lasts", async () => {
    const { controller, stored } = await setup({ notes: { ...BOOK } });
    await withConfirmedPlan(controller);
    expect(controller.worldEntities()).toBeNull();
    await controller.check();
    const [mira] = controller.worldEntities()!;
    expect(mira.name).toBe("Mira");
    expect(mira.rows.map((r) => `${r.label}: ${r.value}`)).toEqual(["Eye colour: green"]);
    expect(engine!.starts).toHaveLength(1);
    expect(stored.has("plugins/bunsho/world.json")).toBe(true);
  });

  it("is still there after closing and reopening", async () => {
    const first = await setup({ notes: { ...BOOK } });
    await withConfirmedPlan(first.controller);
    await first.controller.check();
    const saved = first.data() as Record<string, unknown>;
    const stored = [...first.stored];
    await engine!.close();
    const second = await setup({ notes: { ...BOOK }, world: stored, data: { ...saved, engineUrl: "http://127.0.0.1:1" } });
    expect(second.controller.worldEntities()?.[0].name).toBe("Mira");
  });

  it("marks a fact when its page changes after the check", async () => {
    const notes = { ...BOOK };
    const { controller } = await setup({ notes });
    await withConfirmedPlan(controller);
    await controller.check();
    const row = controller.worldEntities()![0].rows[0];
    expect(controller.isStale(row)).toBe(false);
    notes["Book/a.md"] = "Her eyes were green, and more.";
    await controller.refreshScan();
    expect(controller.isStale(row)).toBe(true);
  });

  it("shows nothing for a different source, and returns when it is picked again", async () => {
    const notes = { ...BOOK, "Other/c.md": "Text." };
    let choice: SourceChoice = { kind: "folder", path: "Other" };
    const { controller } = await setup({ notes, host: { pickSource: () => Promise.resolve(choice) } });
    await withConfirmedPlan(controller);
    await controller.check();
    await controller.chooseSource();
    expect(controller.worldEntities()).toBeNull();
    choice = FOLDER;
    await controller.chooseSource();
    expect(controller.worldEntities()).not.toBeNull();
  });

  it("ignores a file from another review, and a damaged one", async () => {
    const first = await setup({ notes: { ...BOOK } });
    await withConfirmedPlan(first.controller);
    await first.controller.check();
    const saved = first.data() as Record<string, unknown>;
    const path = "plugins/bunsho/world.json";
    await engine!.close();
    const other = await setup({ notes: { ...BOOK }, world: [[path, JSON.stringify({ version: 1, snapshotId: "other", reads: [], cast: [] })]], data: saved });
    expect(other.controller.worldEntities()).toBeNull();
    await engine!.close();
    const damaged = await setup({ notes: { ...BOOK }, world: [[path, "{not json"]], data: saved });
    expect(damaged.controller.worldEntities()).toBeNull();
  });

  it("is removed on sign-out, along with the findings", async () => {
    const { controller, stored } = await setup({ notes: { ...BOOK } });
    await withConfirmedPlan(controller);
    await controller.check();
    await controller.signOut();
    expect(stored.has("plugins/bunsho/world.json")).toBe(false);
    expect(controller.worldEntities()).toBeNull();
  });

  it("a file that cannot be written does not lose the paid check", async () => {
    const { controller } = await setup({ notes: { ...BOOK }, failWrite: true });
    await withConfirmedPlan(controller);
    await controller.check();
    expect(controller.phase.kind).toBe("idle");
    expect(controller.currentReview()?.issues).toHaveLength(1);
    expect(controller.worldEntities()?.[0].name).toBe("Mira");
  });

  it("maps a fact in a long note's later part to the note's text", async () => {
    const line = (seed: string, i: number) => `${seed} ${i} is a line of plain prose that keeps on going for a while.`;
    const body = (seed: string) => Array.from({ length: 500 }, (_, i) => line(seed, i)).join("\n");
    const raw = `${body("before")}\nHer eyes were green that day.\n${body("after")}`;
    const { controller } = await setup({ notes: { "Book/long.md": raw } });
    await withConfirmedPlan(controller);
    await controller.check();
    const row = controller.worldEntities()![0].rows[0];
    const page = controller.currentReview()!.pages.find((p) => p.pageId === row.pageId)!;
    expect(raw.slice(page.noteOffset + row.start, page.noteOffset + row.end)).toBe(row.quote);
  });
});

describe("saving", () => {
  it("writes one at a time, and the last write holds the latest data", async () => {
    let running = 0;
    let most = 0;
    const writes: string[] = [];
    const { controller } = await setup({ notes: { "Book/a.md": "One." }, host: { saveData: async (next) => {
      running++;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 5));
      writes.push(JSON.stringify(next.dismissed));
      running--;
    } } });
    await Promise.all([controller.dismiss("a", true), controller.dismiss("b", true), controller.dismiss("c", true)]);
    expect(most).toBe(1);
    expect(JSON.parse(writes[writes.length - 1])).toEqual(["a", "b", "c"]);
  });

  it("a failed write does not block the next one", async () => {
    let fail = false;
    const { controller } = await setup({ notes: { "Book/a.md": "One." }, host: { saveData: () => {
      if (fail) { fail = false; return Promise.reject(new Error("disk")); }
      return Promise.resolve();
    } } });
    fail = true;
    await expect(controller.save()).rejects.toThrow("disk");
    await expect(controller.save()).resolves.toBeUndefined();
  });
});

describe("older data", () => {
  it("turns the old folder setting into the picked source, without its slashes", async () => {
    const { controller, saved } = await setup({ notes: { "Book/a.md": "One." } });
    expect(saved.length).toBeGreaterThan(0);
    const fresh = new ContinuityController({
      app: { secretStorage: { getSecret: () => "", setSecret: () => undefined }, vault: { adapter: { exists: () => Promise.resolve(false) } } } as never, version: "0", dir: "x", openPanel: () => Promise.resolve(), changed: () => undefined,
      loadData: () => Promise.resolve({ manuscriptFolder: " /My Book/ ", lastReview: { chapters: [], issues: [] } }), saveData: () => Promise.resolve(),
      confirmCheck: () => Promise.resolve("cancel"), reviewPlan: () => Promise.resolve(null), pickSource: () => Promise.resolve(null), confirmReplaceProject: () => Promise.resolve(false),
    });
    await fresh.load();
    expect(fresh.data.source).toEqual({ kind: "folder", path: "My Book" });
    expect(fresh.data.lastReview).toBeNull();
    expect(controller.data.source).toEqual(FOLDER);
  });
});
