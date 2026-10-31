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

/** GET that resolves to null instead of throwing (optional reads such as the plan and the project registry). */
export async function tryGetJson(transport: PipelineV3Transport, path: string): Promise<unknown> {
  try { return await transport.getJson(path); } catch { return null; }
}

/** The account's spendable credits from GET /v1/credits (`total`), or null when the engine does not say. */
export async function readBalance(transport: PipelineV3Transport): Promise<number | null> {
  const answer = await transport.getJson("/v1/credits");
  const total = (answer as { total?: unknown } | null)?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}
