/** HTTP to the Bunsho engine through Obsidian's requestUrl (no CORS), with the writer's Firebase ID token. */
import { requestUrl } from "obsidian";
import type { FormPost, TokenSource } from "@/lib/services/auth/authService";
import type { PipelineV3Transport } from "@/lib/contract/pipelineV3Client";

export const CLIENT_NAME = "obsidian";

export interface ConnectionOptions {
  baseUrl: string;
  tokens: TokenSource;
  installId: string;
  version: string;
  /** Local development against an engine started with AUTH_OPTIONAL=true and NODE_ENV=development only. */
  devUid?: string;
  logger: PipelineV3Transport["logger"];
}

export const formPost: FormPost = async (url, body, contentType) => {
  const response = await requestUrl({ url, method: "POST", body, contentType, throw: false });
  let json: unknown = null;
  try { json = response.json as unknown; } catch { json = null; }
  return { status: response.status, json };
};

export async function authHeaders(options: Pick<ConnectionOptions, "tokens" | "installId" | "version" | "devUid">): Promise<Record<string, string>> {
  const common = { "x-bunsho-install": options.installId, "x-bunsho-client": `${CLIENT_NAME}/${options.version}` };
  if (options.devUid) return { ...common, Authorization: "Bearer dev", "x-dev-uid": options.devUid };
  return { ...common, Authorization: `Bearer ${await options.tokens.idToken()}` };
}

export function makeTransport(options: ConnectionOptions): PipelineV3Transport {
  const baseUrl = options.baseUrl.replace(/\/+$/u, "");
  return {
    baseUrl,
    logger: options.logger,
    headers: () => authHeaders(options),
    async getJson(path: string): Promise<unknown> {
      const response = await requestUrl({ url: `${baseUrl}${path}`, method: "GET", headers: await authHeaders(options), throw: false });
      if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`Engine answered ${response.status}`), { status: response.status });
      return response.json as unknown;
    },
  };
}

/** Authenticated JSON POST; resolves with the parsed answer, throws with `status` on a non-OK answer. */
export async function postJson(options: ConnectionOptions, path: string, body: unknown): Promise<unknown> {
  const response = await requestUrl({ url: `${options.baseUrl.replace(/\/+$/u, "")}${path}`, method: "POST", contentType: "application/json",
    body: JSON.stringify(body), headers: await authHeaders(options), throw: false });
  if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`Engine answered ${response.status}`), { status: response.status });
  return response.json as unknown;
}

/** A non-OK answer to a metered call, with the body kept: `charged` is the engine's own figure, null when it did not say. */
export class EngineRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly charged: number | null, readonly body: string) {
    super(message);
    this.name = "EngineRequestError";
  }
}

/** The engine's answer took longer than the caller waits. It may still have spent: a retry carries the same key. */
export class EngineTimeoutError extends Error {}

const bodyField = (body: string, field: string): unknown => { try { return (JSON.parse(body) as Record<string, unknown> | null)?.[field]; } catch { return undefined; } };

/**
 * A metered POST: the idempotency key dedupes a retry, the error body is kept, and the wait is bounded (requestUrl has no timeout of its own). The request itself cannot be
 * cancelled, so a late answer is dropped.
 */
export async function postMetered(options: ConnectionOptions, path: string, body: unknown, idempotencyKey: string, timeoutMs: number): Promise<unknown> {
  const request = async (): Promise<unknown> => {
    const response = await requestUrl({ url: `${options.baseUrl.replace(/\/+$/u, "")}${path}`, method: "POST", contentType: "application/json",
      body: JSON.stringify(body), headers: { ...(await authHeaders(options)), "x-idempotency-key": idempotencyKey }, throw: false });
    if (response.status >= 200 && response.status < 300) return response.json as unknown;
    const text = typeof response.text === "string" ? response.text : "";
    const code = bodyField(text, "code");
    const charged = bodyField(text, "charged");
    throw new EngineRequestError(`Engine answered ${response.status}`, response.status, typeof code === "string" ? code : null,
      typeof charged === "number" && Number.isFinite(charged) && charged >= 0 ? charged : null, text.slice(0, 2_000));
  };
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new EngineTimeoutError(`No answer from ${path}`)), timeoutMs); });
  try { return await Promise.race([request(), timeout]); } finally { window.clearTimeout(timer); }
}

/** GET that resolves to null instead of throwing (optional reads such as the plan and the project registry). */
export async function tryGetJson(transport: PipelineV3Transport, path: string): Promise<unknown> {
  try { return await transport.getJson(path); } catch { return null; }
}

/**
 * Claims the account's one-time starter credits (POST /v1/credits/starter), as the desktop does at sign-in. The engine
 * grants them once per account and answers repeat calls with nothing new, so this is safe to call every session.
 * Resolves false instead of throwing: a failed claim is simply made again on the next refresh.
 */
export async function claimStarterCredits(connection: ConnectionOptions): Promise<boolean> {
  try { await postJson(connection, "/v1/credits/starter", {}); return true; } catch { return false; }
}

/** The account's spendable credits and the engine's price list from GET /v1/credits, each null when the engine does not say. */
export async function readCredits(transport: PipelineV3Transport): Promise<{ balance: number | null; opCosts: Record<string, number> | null }> {
  const answer = (await transport.getJson("/v1/credits")) as { total?: unknown; opCosts?: unknown } | null;
  const total = answer?.total;
  const costs = answer?.opCosts;
  const priced = costs && typeof costs === "object" && !Array.isArray(costs)
    ? Object.fromEntries(Object.entries(costs).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) : null;
  return { balance: typeof total === "number" && Number.isFinite(total) ? total : null, opCosts: priced };
}
