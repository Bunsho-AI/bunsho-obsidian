/**
 * Google sign-in for the plugin, through Firebase's own web login: the same Google account and Firebase uid the desktop app
 * uses, so the credit balance is the same.
 *
 *   1. Serve a one-time sign-in page from this machine (localhost is an authorized Firebase domain) and open it in the browser.
 *   2. The page runs Firebase's Google popup and posts the Firebase refresh token back to the same local server.
 *   3. Keep only the refresh token; mint a fresh ID token from it (securetoken) whenever the engine needs one.
 *
 * No Google client secret ships with the plugin. The engine is unchanged: it verifies a Firebase ID token as it does for the desktop app.
 */
import { randomBytes } from "node:crypto";
import * as http from "node:http";
import { AUTH_CONFIG, missingSignInValues } from "@/lib/services/auth/authConfig";
import { signInPageHtml } from "@/lib/services/auth/signInPage";

export type FormPost = (url: string, body: string, contentType: "application/x-www-form-urlencoded" | "application/json")
  => Promise<{ status: number; json: unknown }>;

export interface SessionStore {
  get(): Promise<string | null>;
  set(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export class AuthError extends Error {
  constructor(readonly code: "not_configured" | "cancelled" | "superseded" | "failed" | "signed_out", message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthConfigShape { firebaseApiKey: string; firebaseAuthDomain: string; firebaseAppId: string }

const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const b64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

export interface BrowserSession { refreshToken: string }

export interface BrowserSignIn { port: number; session: Promise<void>; cancel: () => void }

const MAX_BODY_BYTES = 64 * 1024;

const listen = (server: http.Server, port: number, host: string): Promise<number> => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, () => { server.off("error", reject); resolve((server.address() as { port: number }).port); });
});

/**
 * The page opens on `localhost`, which a browser may try on either loopback address, so both are held on one port: otherwise
 * another local process could answer on the free one, on an origin Firebase trusts. A machine without IPv6 needs only the first.
 */
async function listenOnLoopback(handler: http.RequestListener, sockets: Set<import("node:net").Socket>): Promise<{ port: number; servers: http.Server[] }> {
  const create = () => {
    const server = http.createServer(handler);
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    return server;
  };
  for (let attempt = 0; ; attempt++) {
    const v4 = create();
    const port = await listen(v4, 0, "127.0.0.1");
    const v6 = create();
    try {
      await listen(v6, port, "::1");
      return { port, servers: [v4, v6] };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") return { port, servers: [v4] };
      v4.close();
      if (attempt >= 4) throw error;
    }
  }
}

/**
 * Serves the sign-in page once on this machine. `accept` runs on what the page posts back, and the page is only told it
 * worked once `accept` has finished. Only the page knows the state.
 */
export async function waitForBrowserSignIn(state: string, page: string, accept: (session: BrowserSession) => Promise<void>, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<BrowserSignIn> {
  const sockets = new Set<import("node:net").Socket>();
  let servers: http.Server[] = [];
  let port = 0;
  let settle!: { resolve(): void; reject(error: Error): void };
  const session = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
  session.catch(() => undefined);
  let completing = false;
  const stop = () => { window.clearTimeout(timer); for (const server of servers) server.close(); for (const socket of sockets) socket.destroy(); };
  const timer = window.setTimeout(() => { stop(); settle.reject(new AuthError("cancelled", "Sign-in timed out.")); }, timeoutMs);
  const answer = (res: http.ServerResponse, status: number, type = "text/plain", body = "") => {
    res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store", Connection: "close" });
    return new Promise<void>((resolve) => res.end(body, resolve));
  };
  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === `/signin/${state}`) { void answer(res, 200, "text/html", page); return; }
    if (req.method !== "POST" || url.pathname !== "/complete") { void answer(res, 404); return; }
    // Another local process or a page probing ports can neither finish nor cancel the sign-in.
    if (req.headers.origin !== `http://localhost:${port}`) { void answer(res, 403); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { void answer(res, 413); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      let body: unknown = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* answered below */ }
      if (!record(body) || body.state !== state || typeof body.refreshToken !== "string" || !body.refreshToken) { void answer(res, 400); return; }
      if (completing) { void answer(res, 409); return; }
      completing = true;
      window.clearTimeout(timer);
      void accept({ refreshToken: body.refreshToken }).then(
        () => answer(res, 200).then(() => { stop(); settle.resolve(); }),
        (error: Error) => answer(res, 400).then(() => { stop(); settle.reject(error); }),
      );
    });
  };
  try {
    ({ port, servers } = await listenOnLoopback(handler, sockets));
  } catch (error) {
    window.clearTimeout(timer);
    throw error;
  }
  return { port, session, cancel: () => { stop(); settle.reject(new AuthError("superseded", "Sign-in was cancelled.")); } };
}

interface FirebaseTokens { idToken: string; refreshToken: string; expiresInSeconds: number }

function firebaseTokens(json: unknown): FirebaseTokens {
  if (!record(json)) throw new AuthError("failed", "Sign-in failed.");
  const { id_token: idToken, refresh_token: refreshToken } = json;
  const expires = Number(json.expires_in);
  if (typeof idToken !== "string" || typeof refreshToken !== "string" || !idToken || !refreshToken) throw new AuthError("failed", "Sign-in failed.");
  return { idToken, refreshToken, expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3600 };
}

/** securetoken answers that mean the refresh token itself is no good (as opposed to quota, network or key problems). */
const DEAD_SESSION = ["TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN", "INVALID_GRANT_TYPE", "MISSING_REFRESH_TOKEN"];

export function deadSession(status: number, json: unknown): boolean {
  if (status !== 400 && status !== 401) return false;
  const message = record(json) && record(json.error) && typeof json.error.message === "string" ? json.error.message : "";
  return DEAD_SESSION.some((code) => message.startsWith(code));
}

export async function refreshFirebaseIdToken(post: FormPost, config: AuthConfigShape, refreshToken: string): Promise<FirebaseTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString();
  const { status, json } = await post(`https://securetoken.googleapis.com/v1/token?key=${config.firebaseApiKey}`, body, "application/x-www-form-urlencoded");
  if (deadSession(status, json)) throw new AuthError("signed_out", "Your Bunsho sign-in has expired. Sign in again.");
  if (status < 200 || status >= 300) throw new AuthError("failed", "Could not reach Bunsho to refresh your sign-in. Try again shortly.");
  return firebaseTokens(json);
}

/** Hands out a valid Firebase ID token, refreshing it from the stored refresh token (single flight). */
export class TokenSource {
  private cached: { idToken: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  /** Bumped when the session changes: a refresh that started before it must not write its token back. */
  private generation = 0;
  private cancelPending: (() => void) | null = null;
  private attempt = 0;

  constructor(private readonly post: FormPost, private readonly store: SessionStore, private readonly config: AuthConfigShape = AUTH_CONFIG,
    private readonly now: () => number = Date.now) {}

  async signedIn(): Promise<boolean> { return (await this.store.get()) !== null; }

  async idToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.idToken;
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const generation = this.generation;
    const refreshToken = await this.store.get();
    if (!refreshToken) throw new AuthError("signed_out", "Sign in to check your manuscript.");
    try {
      const tokens = await refreshFirebaseIdToken(this.post, this.config, refreshToken);
      if (generation !== this.generation) throw new AuthError("signed_out", "Signed out.");
      await this.store.set(tokens.refreshToken);
      this.cached = { idToken: tokens.idToken, expiresAt: this.now() + tokens.expiresInSeconds * 1000 };
      return tokens.idToken;
    } catch (error) {
      if (error instanceof AuthError && error.code === "signed_out" && generation === this.generation) { this.cached = null; await this.store.clear(); }
      throw error;
    }
  }

  /** The newest sign-in wins: an earlier one still waiting on its browser tab stops, and that tab can no longer complete. */
  async signIn(openUrl: (url: string) => void): Promise<void> {
    if (missingSignInValues(this.config).length > 0) {
      throw new AuthError("not_configured", "Sign-in is not set up in this build of the plugin yet.");
    }
    // One account per sign-in: what the plugin holds for this one (findings, starter claim) goes with signing out.
    if (await this.signedIn()) throw new AuthError("failed", "You're already signed in. Sign out first to use another account.");
    this.cancelSignIn();
    const attempt = ++this.attempt;
    const generation = this.generation;
    const state = b64url(randomBytes(16));
    const { port, session, cancel } = await waitForBrowserSignIn(state, signInPageHtml(this.config, state), async ({ refreshToken }) => {
      // Also proves the token is real for this Firebase project before anything is stored.
      const tokens = await refreshFirebaseIdToken(this.post, this.config, refreshToken);
      if (generation !== this.generation) throw new AuthError("superseded", "Sign-in was cancelled.");
      this.generation++;
      this.inflight = null;
      await this.store.set(tokens.refreshToken);
      this.cached = { idToken: tokens.idToken, expiresAt: this.now() + tokens.expiresInSeconds * 1000 };
    });
    if (attempt !== this.attempt || generation !== this.generation) { cancel(); return session; }
    this.cancelPending = cancel;
    openUrl(`http://localhost:${port}/signin/${state}`);
    try {
      await session;
    } finally {
      if (this.cancelPending === cancel) this.cancelPending = null;
    }
  }

  /** Stops a sign-in still waiting on its browser tab, if any (a newer sign-in, sign-out, the plugin unloading). */
  cancelSignIn(): void {
    this.attempt++;
    this.cancelPending?.();
    this.cancelPending = null;
  }

  async signOut(): Promise<void> { this.cancelSignIn(); this.generation++; this.cached = null; this.inflight = null; await this.store.clear(); }
}
