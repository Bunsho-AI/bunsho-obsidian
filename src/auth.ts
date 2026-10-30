/**
 * Google sign-in for the plugin, without a Bunsho-specific token: the same Google account and Firebase uid the desktop app
 * uses, so the credit balance is the same.
 *
 *   1. Open Google's consent page in the system browser (authorization code + PKCE, loopback redirect on 127.0.0.1).
 *   2. Exchange the code at Google for an id_token.
 *   3. Exchange that at Firebase (accounts:signInWithIdp) for a Firebase ID token and a Firebase refresh token.
 *   4. Keep only the Firebase refresh token; mint a fresh ID token from it (securetoken) whenever the engine needs one.
 *
 * The engine is unchanged: it verifies a Firebase ID token like it does for the desktop app.
 */
import { createHash, randomBytes } from "node:crypto";
import * as http from "node:http";
import { AUTH_CONFIG } from "./authConfig";

export type FormPost = (url: string, body: string, contentType: "application/x-www-form-urlencoded" | "application/json")
  => Promise<{ status: number; json: unknown }>;

export interface SessionStore {
  get(): Promise<string | null>;
  set(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export class AuthError extends Error {
  constructor(readonly code: "not_configured" | "cancelled" | "failed" | "signed_out", message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthConfigShape { firebaseApiKey: string; googleClientId: string; googleClientSecret: string }

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const b64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

const PAGE = (heading: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bunsho</title></head>
<body style="margin:0;background:#efe9dc;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="background:#fffdf8;border:1px solid #e8e1d2;border-radius:12px;padding:40px;max-width:420px;margin:24px;text-align:center;border-top:3px solid #dfa803">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#2f2a20;margin-bottom:20px">Bunsho</div>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:400;color:#2f2a20;margin:0 0 12px">${heading}</h1>
<p style="font-size:15px;line-height:1.5;color:#55493a;margin:0">${body}</p></div></body></html>`;

/** Listens once on 127.0.0.1 for Google's redirect; resolves with the authorization code. Fixed copy only on the page. */
export function waitForAuthorizationCode(state: string, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((resolveStart, rejectStart) => {
    const sockets = new Set<import("node:net").Socket>();
    const server = http.createServer();
    let settle: { resolve(code: string): void; reject(error: Error): void };
    const code = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
    code.catch(() => undefined);
    const stop = () => { server.close(); for (const socket of sockets) socket.destroy(); };
    const timer = setTimeout(() => { stop(); settle.reject(new AuthError("cancelled", "Sign-in timed out.")); }, timeoutMs);
    timer.unref?.();
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") { res.writeHead(204, { Connection: "close" }); res.end(); return; }
      const reply = (page: string) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", Connection: "close" }); res.end(page); };
      const authorised = url.searchParams.get("state") === state && url.searchParams.get("code");
      if (!authorised) {
        reply(PAGE("Sign-in didn't complete.", "Return to Obsidian and try again."));
        clearTimeout(timer); stop();
        settle.reject(new AuthError(url.searchParams.get("error") ? "cancelled" : "failed", "Sign-in did not complete."));
        return;
      }
      reply(PAGE("You're signed in.", "You can close this tab and return to Obsidian."));
      clearTimeout(timer); stop();
      settle.resolve(url.searchParams.get("code")!);
    });
    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => resolveStart({ port: (server.address() as { port: number }).port, code }));
  });
}

interface FirebaseTokens { idToken: string; refreshToken: string; expiresInSeconds: number; email?: string }

function firebaseTokens(json: unknown, kind: "idp" | "refresh"): FirebaseTokens {
  if (!record(json)) throw new AuthError("failed", "Sign-in failed.");
  const idToken = kind === "idp" ? json.idToken : json.id_token;
  const refreshToken = kind === "idp" ? json.refreshToken : json.refresh_token;
  const expires = Number(kind === "idp" ? json.expiresIn : json.expires_in);
  if (typeof idToken !== "string" || typeof refreshToken !== "string" || !idToken || !refreshToken) throw new AuthError("failed", "Sign-in failed.");
  return { idToken, refreshToken, expiresInSeconds: Number.isFinite(expires) && expires > 0 ? expires : 3600, email: typeof json.email === "string" ? json.email : undefined };
}

export async function exchangeGoogleCode(post: FormPost, config: AuthConfigShape, code: string, verifier: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({ code, client_id: config.googleClientId, client_secret: config.googleClientSecret,
    code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }).toString();
  const { status, json } = await post(GOOGLE_TOKEN_URL, body, "application/x-www-form-urlencoded");
  if (status < 200 || status >= 300 || !record(json) || typeof json.id_token !== "string") throw new AuthError("failed", "Google sign-in failed.");
  return json.id_token;
}

export async function firebaseSignInWithGoogle(post: FormPost, config: AuthConfigShape, googleIdToken: string): Promise<FirebaseTokens> {
  const body = JSON.stringify({ postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
    requestUri: "http://localhost", returnSecureToken: true, returnIdpCredential: true });
  const { status, json } = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${config.firebaseApiKey}`, body, "application/json");
  if (status < 200 || status >= 300) throw new AuthError("failed", "Bunsho sign-in failed.");
  return firebaseTokens(json, "idp");
}

export async function refreshFirebaseIdToken(post: FormPost, config: AuthConfigShape, refreshToken: string): Promise<FirebaseTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString();
  const { status, json } = await post(`https://securetoken.googleapis.com/v1/token?key=${config.firebaseApiKey}`, body, "application/x-www-form-urlencoded");
  if (status >= 400 && status < 500) throw new AuthError("signed_out", "Your Bunsho sign-in has expired. Sign in again.");
  if (status < 200 || status >= 300) throw new AuthError("failed", "Could not reach Bunsho to refresh your sign-in.");
  return firebaseTokens(json, "refresh");
}

/** Hands out a valid Firebase ID token, refreshing it from the stored refresh token (single flight). */
export class TokenSource {
  private cached: { idToken: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  email: string | undefined;

  constructor(private readonly post: FormPost, private readonly store: SessionStore, private readonly config: AuthConfigShape = AUTH_CONFIG,
    private readonly now: () => number = Date.now) {}

  async signedIn(): Promise<boolean> { return (await this.store.get()) !== null; }

  async idToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.idToken;
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const refreshToken = await this.store.get();
    if (!refreshToken) throw new AuthError("signed_out", "Sign in to check your manuscript.");
    try {
      const tokens = await refreshFirebaseIdToken(this.post, this.config, refreshToken);
      await this.store.set(tokens.refreshToken);
      this.cached = { idToken: tokens.idToken, expiresAt: this.now() + tokens.expiresInSeconds * 1000 };
      return tokens.idToken;
    } catch (error) {
      if (error instanceof AuthError && error.code === "signed_out") { this.cached = null; await this.store.clear(); }
      throw error;
    }
  }

  async signIn(openUrl: (url: string) => void): Promise<void> {
    if (!this.config.googleClientId || !this.config.googleClientSecret) {
      throw new AuthError("not_configured", "Sign-in is not set up in this build of the plugin yet.");
    }
    const { verifier, challenge } = pkcePair();
    const state = b64url(randomBytes(16));
    const { port, code } = await waitForAuthorizationCode(state);
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    openUrl(buildGoogleAuthUrl(this.config.googleClientId, redirectUri, challenge, state));
    const googleIdToken = await exchangeGoogleCode(this.post, this.config, await code, verifier, redirectUri);
    const tokens = await firebaseSignInWithGoogle(this.post, this.config, googleIdToken);
    await this.store.set(tokens.refreshToken);
    this.email = tokens.email;
    this.cached = { idToken: tokens.idToken, expiresAt: this.now() + tokens.expiresInSeconds * 1000 };
  }

  async signOut(): Promise<void> { this.cached = null; await this.store.clear(); }
}
