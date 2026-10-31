import { describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import { TokenSource, buildGoogleAuthUrl, pkcePair, refreshFirebaseIdToken, waitForAuthorizationCode, type FormPost, type SessionStore } from "@/lib/services/auth/authService";

const config = { firebaseApiKey: "key", googleClientId: "cid", googleClientSecret: "secret" };
const memoryStore = (initial: string | null): SessionStore & { value: string | null } => {
  const store = { value: initial, get: async () => store.value, set: async (v: string) => { store.value = v; }, clear: async () => { store.value = null; } };
  return store;
};
const ok = (json: unknown): ReturnType<FormPost> => Promise.resolve({ status: 200, json });

describe("sign-in building blocks", () => {
  it("PKCE challenge is the S256 of the verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("auth url carries PKCE, state and loopback redirect", () => {
    const url = new URL(buildGoogleAuthUrl("cid", "http://127.0.0.1:5/callback", "chal", "st"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5/callback");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("loopback ignores a wrong state and still accepts Google's redirect afterwards", async () => {
    const { port, code } = await waitForAuthorizationCode("good", 5000);
    expect((await fetch(`http://127.0.0.1:${port}/callback?code=evil&state=evil`)).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)).status).toBe(400);
    await fetch(`http://127.0.0.1:${port}/callback?code=real&state=good`);
    await expect(code).resolves.toBe("real");
  });

  it("loopback reports a cancelled consent with the right state", async () => {
    const { port, code } = await waitForAuthorizationCode("good", 5000);
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=good`);
    await expect(code).rejects.toMatchObject({ code: "cancelled" });
  });

  it("loopback resolves the code and refuses non-callback paths", async () => {
    const { port, code } = await waitForAuthorizationCode("good", 5000);
    expect((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status).toBe(204);
    await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=good`);
    await expect(code).resolves.toBe("abc");
    await new Promise<void>((resolve) => { http.get(`http://127.0.0.1:${port}/`).on("error", () => resolve()).on("response", () => resolve()); });
  });
});

describe("TokenSource", () => {
  it("refreshes once for concurrent callers, caches, and rotates the stored refresh token", async () => {
    const post = vi.fn<FormPost>(() => ok({ id_token: "ID1", refresh_token: "R2", expires_in: "3600" }));
    const store = memoryStore("R1");
    const source = new TokenSource(post, store, config, () => 1_000_000);
    const [a, b] = await Promise.all([source.idToken(), source.idToken()]);
    expect([a, b]).toEqual(["ID1", "ID1"]);
    expect(await source.idToken()).toBe("ID1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(store.value).toBe("R2");
  });

  it("refreshes again after the token is about to expire", async () => {
    let now = 0;
    const post = vi.fn<FormPost>(() => ok({ id_token: `ID${now}`, refresh_token: "R", expires_in: "3600" }));
    const source = new TokenSource(post, memoryStore("R"), config, () => now);
    await source.idToken();
    now = 3_600_000 - 30_000;
    await source.idToken();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("signs the writer out when the refresh token is rejected", async () => {
    const store = memoryStore("R");
    const source = new TokenSource(() => Promise.resolve({ status: 400, json: { error: { message: "TOKEN_EXPIRED" } } }), store, config);
    await expect(source.idToken()).rejects.toMatchObject({ code: "signed_out" });
    expect(store.value).toBeNull();
  });

  it.each([[503, {}], [429, { error: { message: "QUOTA_EXCEEDED" } }], [403, { error: { message: "API_KEY_HTTP_REFERRER_BLOCKED" } }], [400, { error: { message: "SOMETHING_ELSE" } }]])(
    "keeps the session on a %i that does not mean the sign-in is dead", async (status, json) => {
      const store = memoryStore("R");
      const source = new TokenSource(() => Promise.resolve({ status, json }), store, config);
      await expect(source.idToken()).rejects.toMatchObject({ code: "failed" });
      expect(store.value).toBe("R");
    });

  it("a refresh that finishes after sign-out does not sign the writer back in", async () => {
    let answer!: (value: { status: number; json: unknown }) => void;
    const store = memoryStore("R1");
    const source = new TokenSource(() => new Promise((resolve) => { answer = resolve; }), store, config);
    const pending = source.idToken();
    await new Promise((r) => setTimeout(r, 0));
    await source.signOut();
    answer({ status: 200, json: { id_token: "ID", refresh_token: "R2", expires_in: "3600" } });
    await expect(pending).rejects.toMatchObject({ code: "signed_out" });
    expect(store.value).toBeNull();
  });

  it("says sign-in is not set up when the OAuth client is empty", async () => {
    const source = new TokenSource(() => ok({}), memoryStore(null), { ...config, googleClientId: "" });
    await expect(source.signIn(() => undefined)).rejects.toMatchObject({ code: "not_configured" });
  });

  it("parses a Firebase refresh answer", async () => {
    const tokens = await refreshFirebaseIdToken(() => ok({ id_token: "I", refresh_token: "R", expires_in: "60" }), config, "x");
    expect(tokens).toMatchObject({ idToken: "I", refreshToken: "R", expiresInSeconds: 60 });
  });
});
