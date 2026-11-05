/**
 * The engine's Director routes: plain JSON over requestUrl, with the writer's token. Every call is metered, so every call carries an idempotency key. The key belongs to the attempt, the
 * same request sent again: a timeout, a lost connection or a 5xx is ambiguous, because the engine may have charged and done the work, so the key is kept and a retry pays once. A 2xx or
 * 4xx ends the attempt. Keys last the session, as on the desktop.
 */
import { parsePlanResponse, parseRenderBeat, parseRenderScene, type EnginePlanRequest, type EnginePlanResponse, type EngineRenderBeatRequest, type EngineRenderBeatResponse, type EngineRenderSceneRequest, type EngineRenderSceneResponse } from "@/lib/contract/director.types";
import { EngineRequestError, postMetered, type ConnectionOptions } from "@/lib/services/engine/engineService";
import { sha256 } from "@/utils/hash";

/** As the desktop waits (engineClient.ts). */
const PLAN_TIMEOUT_MS = 120_000;
const RENDER_BEAT_TIMEOUT_MS = 120_000;
const RENDER_SCENE_TIMEOUT_MS = 300_000;
const MAX_PENDING_ATTEMPTS = 200;

/** The engine said something a card cannot be built from. It may have charged. */
export class BadAnswerError extends Error {}

export class DirectorEngine {
  private readonly attempts = new Map<string, string>();

  constructor(private readonly connection: () => ConnectionOptions) {}

  private keyFor(slot: string): string {
    const known = this.attempts.get(slot);
    if (known) return known;
    if (this.attempts.size >= MAX_PENDING_ATTEMPTS) { const oldest = this.attempts.keys().next().value; if (oldest) this.attempts.delete(oldest); }
    const key = crypto.randomUUID();
    this.attempts.set(slot, key);
    return key;
  }

  private async post<T>(path: string, body: unknown, timeoutMs: number, parse: (answer: unknown) => T | null): Promise<T> {
    const slot = sha256(`${path}\u0000${JSON.stringify(body)}`);
    try {
      const answer = await postMetered(this.connection(), path, body, this.keyFor(slot), timeoutMs);
      this.attempts.delete(slot);
      const parsed = parse(answer);
      if (!parsed) throw new BadAnswerError(`The engine's answer on ${path} could not be read`);
      return parsed;
    } catch (error) {
      if (error instanceof EngineRequestError && error.status < 500) this.attempts.delete(slot);
      throw error;
    }
  }

  plan(request: EnginePlanRequest): Promise<EnginePlanResponse> { return this.post("/v1/plan", request, PLAN_TIMEOUT_MS, parsePlanResponse); }
  renderScene(request: EngineRenderSceneRequest): Promise<EngineRenderSceneResponse> { return this.post("/v1/render/scene", request, RENDER_SCENE_TIMEOUT_MS, parseRenderScene); }
  renderBeat(request: EngineRenderBeatRequest): Promise<EngineRenderBeatResponse> { return this.post("/v1/render/beat", request, RENDER_BEAT_TIMEOUT_MS, parseRenderBeat); }
}
