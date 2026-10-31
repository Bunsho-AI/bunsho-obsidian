import { afterEach, describe, expect, it } from "vitest";
import { startMockEngine } from "../scripts/mock-engine.mjs";
import { PipelineV3Client, PipelineV3Error } from "../src/vendor/pipelineV3Client";
import { parsePipelineV3Health } from "../src/vendor/pipelineV3Frames";
import { runReview } from "../src/review";
import { buildChapters } from "../src/structure";

const note = (name: string, text: string) => ({ path: `Manuscript/${name}.md`, basename: name, text });
const { chapters } = buildChapters([
  note("01 Arrival", "# One\nMira stepped off the ferry. Her eyes were green in the harbour light.\nThe crowd parted."),
  note("02 Letter", "# Two\nShe read the letter twice.\nLater her eyes were brown, and tired, as she folded it."),
]);

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
    const outcome = await runReview({ chapters, health, workspaceId: "w", client, callbacks: { onProgress: (p) => stages.push(p.stage) } });
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
    const outcome = await runReview({ chapters, health, workspaceId: "w", client });
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].citations).toHaveLength(1);
  });

  it("drops a finding whose current passage is not an exact slice of what was sent", async () => {
    const { client, health } = await clientFor({ tamper: true });
    const outcome = await runReview({ chapters, health, workspaceId: "w", client });
    expect(outcome.issues).toHaveLength(0);
    expect(outcome.droppedFindings).toBe(1);
  });

  it("surfaces the engine's own words when a review is refused", async () => {
    const { client, health } = await clientFor({ failWith: "model_unavailable" });
    await expect(runReview({ chapters, health, workspaceId: "w", client })).rejects.toSatisfy(
      (e) => e instanceof PipelineV3Error && e.code === "model_unavailable" && e.detail.charged === false && e.message.includes("You were not charged"));
  });

  it("completes with browser-style timers (Obsidian's renderer: setTimeout returns a number, no unref)", async () => {
    const real = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    const timers = new Map<number, ReturnType<typeof real>>();
    let next = 1;
    const domLike = ((fn: () => void, ms?: number) => { const id = next++; timers.set(id, real(fn, ms)); return id; }) as unknown as typeof setTimeout;
    const { client, health } = await clientFor({ holdOpen: true });
    globalThis.setTimeout = domLike;
    globalThis.clearTimeout = ((id: unknown) => { const t = timers.get(id as number); if (t) realClear(t); else realClear(id as ReturnType<typeof real>); }) as typeof clearTimeout;
    try {
      const outcome = await runReview({ chapters, health, workspaceId: "w", client });
      expect(outcome.issues).toHaveLength(1);
    } finally {
      globalThis.setTimeout = real;
      globalThis.clearTimeout = realClear;
    }
  });

  it("cancels cleanly", async () => {
    const { client, health } = await clientFor();
    const controller = new AbortController();
    const run = runReview({ chapters, health, workspaceId: "w", client, signal: controller.signal, callbacks: { onAccepted: () => controller.abort() } });
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
  });
});
