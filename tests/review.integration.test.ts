import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { PipelineV3Client, PipelineV3Error } from "@/lib/contract/pipelineV3Client";
import { parsePipelineV3Health } from "@/lib/contract/pipelineV3Frames";
import { runReview } from "@/lib/services/review/reviewService";
import { locateQuote } from "@/helpers/locate";
import { projectMarkdown } from "@/utils/markdown";
import { applyPlan, buildItems } from "@/helpers/sources";

const SOURCE = { kind: "folder" as const, path: "Manuscript" };
const note = (name: string, text: string) => ({ noteId: `id-${name}`, path: `Manuscript/${name}.md`, basename: name, text });
const planned = (notes: ReturnType<typeof note>[], source: { kind: "folder" | "note"; path: string } = SOURCE, excluded: string[] = []) => {
  const { items } = buildItems(notes, source);
  return applyPlan(items, { order: items.map((i) => i.id), excluded }).items;
};
const items = planned([
  note("01 Arrival", "# One\nMira stepped off the ferry. Her eyes were green in the harbour light.\nThe crowd parted."),
  note("02 Letter", "# Two\nShe read the letter twice.\nLater her eyes were brown, and tired, as she folded it."),
]);
const prose = (seed: string, chars: number) => {
  const lines: string[] = [];
  for (let n = 0, i = 0; n < chars; i++) { const line = `${seed} ${i} is a line of plain prose that keeps on going for a while.`; lines.push(line); n += line.length + 1; }
  return lines.join("\n");
};

let engine: Awaited<ReturnType<typeof startMockEngine>> | undefined;
afterEach(async () => { await engine?.close(); engine = undefined; });

async function clientFor(options: Parameters<typeof startMockEngine>[0] = {}) {
  engine = await startMockEngine(options);
  const baseUrl = `http://127.0.0.1:${engine.port}`;
  const transport = {
    baseUrl,
    logger: { warn: () => undefined, info: () => undefined },
    headers: async () => ({ Authorization: "Bearer test", "x-bunsho-client": "obsidian/0.1.0" }),
    getJson: async (path: string) => (await fetch(baseUrl + path)).json(),
  };
  const client = new PipelineV3Client(transport);
  return { client, health: parsePipelineV3Health(await transport.getJson("/v1/pipeline/v3/health")) };
}

describe("a review against the engine protocol", () => {
  it("sends chapters whole and returns a finding grounded in the text sent", async () => {
    const { client, health } = await clientFor();
    const stages: string[] = [];
    const outcome = await runReview({ items, source: SOURCE, health, workspaceId: "w", client, callbacks: { onProgress: (p) => stages.push(p.stage) } });
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].message).toContain("green");
    const [prior, current] = outcome.issues[0].citations;
    expect(prior.quoted_text).toContain("green");
    expect(current.quoted_text).toContain("brown");
    expect(stages).toContain("assemble");
    expect(engine!.requests.find((r) => r.socket)?.headers["x-bunsho-client"]).toBe("obsidian/0.1.0");
  });

  it("keeps a finding that still has a grounded current passage when an earlier citation is not exact", async () => {
    const { client, health } = await clientFor({ tamper: "prior" });
    const outcome = await runReview({ items, source: SOURCE, health, workspaceId: "w", client });
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].citations).toHaveLength(1);
  });

  it("drops a finding whose current passage is not an exact slice of what was sent", async () => {
    const { client, health } = await clientFor({ tamper: true });
    const outcome = await runReview({ items, source: SOURCE, health, workspaceId: "w", client });
    expect(outcome.issues).toHaveLength(0);
    expect(outcome.droppedFindings).toBe(1);
  });

  it("surfaces the engine's own words when a review is refused", async () => {
    const { client, health } = await clientFor({ failWith: "model_unavailable" });
    await expect(runReview({ items, source: SOURCE, health, workspaceId: "w", client })).rejects.toSatisfy(
      (e) => e instanceof PipelineV3Error && e.code === "model_unavailable" && e.detail.charged === false && e.message.includes("You were not charged"));
  });

  it("completes with browser-style timers (Obsidian's renderer: setTimeout returns a number, no unref)", async () => {
    const win = window as unknown as { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
    const [realSet, realClear] = [win.setTimeout, win.clearTimeout];
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let next = 1;
    win.setTimeout = ((fn: () => void, ms?: number) => { const id = next++; timers.set(id, globalThis.setTimeout(fn, ms)); return id; }) as unknown as typeof setTimeout;
    win.clearTimeout = ((id: unknown) => { const t = timers.get(id as number); if (t) globalThis.clearTimeout(t); }) as typeof clearTimeout;
    try {
      const { client, health } = await clientFor({ holdOpen: true });
      const outcome = await runReview({ items, source: SOURCE, health, workspaceId: "w", client });
      expect(outcome.issues).toHaveLength(1);
    } finally {
      win.setTimeout = realSet;
      win.clearTimeout = realClear;
    }
  });

  it("relays the engine's one-project refusal for a free account, uncharged", async () => {
    const { client, health } = await clientFor({ registered: { workspaceId: "another", name: "Nine Fathoms" } });
    await expect(runReview({ items, source: SOURCE, health, workspaceId: "w", client })).rejects.toSatisfy(
      (e) => e instanceof PipelineV3Error && e.detail.charged === false && e.message.includes("Nine Fathoms"));
  });

  it("cuts one long note with no structure, sends flagged parts, and maps a finding back into the note", async () => {
    const raw = `${prose("before", 30_000)}\nHer eyes were green that day.\n${prose("middle", 30_000)}\nHer eyes were brown that day.\n${prose("after", 30_000)}`;
    const long = planned([note("Book", raw)], { kind: "note", path: "Manuscript/Book.md" });
    const { client, health } = await clientFor();
    const outcome = await runReview({ items: long, source: { kind: "note", path: "Manuscript/Book.md" }, health, workspaceId: "w", client });

    const sent = engine!.starts[0].pages;
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.every((p, i) => p.part?.index === i && p.part.of === sent.length && p.part.sourceId === long[0].id)).toBe(true);
    expect(outcome.issues).toHaveLength(1);
    for (const citation of outcome.issues[0].citations) {
      const page = outcome.pages.find((p) => p.pageId === citation.page_id)!;
      const hit = locateQuote(citation, projectMarkdown(raw), page.noteOffset);
      expect(hit && raw.slice(hit.from, hit.to)).toBe(citation.quoted_text);
    }
    expect(outcome.coverage).toEqual({ sources: [{ id: long[0].id, label: "Book" }], unreadSources: [], excluded: 0 });
  });

  it("sends chapter notes with no part flag, so they stay what the engine was benched on", async () => {
    const { client, health } = await clientFor();
    await runReview({ items, source: SOURCE, health, workspaceId: "w", client });
    expect(engine!.starts[0].pages.every((p) => !("part" in p))).toBe(true);
  });

  it("never sends what the writer left out, and says it was left out", async () => {
    const notes = [note("01 Arrival", "Her eyes were green."), note("Research", "Secret research notes."), note("02 Letter", "Her eyes were brown.")];
    const left = planned(notes, SOURCE, ["id-Research"]);
    const { client, health } = await clientFor();
    const outcome = await runReview({ items: left, source: SOURCE, health, workspaceId: "w", client });
    expect(engine!.starts[0].pages.map((p) => p.pageId)).toEqual(["id-01 Arrival", "id-02 Letter"]);
    expect(outcome.coverage.excluded).toBe(1);
  });

  it("reads whether the engine accepts parts", async () => {
    expect((await clientFor()).health.readingParts).toBe(true);
    await engine!.close();
    expect((await clientFor({ readingParts: false })).health.readingParts).toBe(false);
  });

  it("cancels cleanly", async () => {
    const { client, health } = await clientFor();
    const controller = new AbortController();
    const run = runReview({ items, source: SOURCE, health, workspaceId: "w", client, signal: controller.signal, callbacks: { onAccepted: () => controller.abort() } });
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
  });
});
