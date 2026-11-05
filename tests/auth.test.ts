import * as net from "node:net";
import { describe, expect, it, vi } from "vitest";
import { uidOfToken, TokenSource, refreshFirebaseIdToken, waitForBrowserSignIn, type FormPost, type SessionStore } from "@/lib/services/auth/authService";
import { signInPageHtml } from "@/lib/services/auth/signInPage";

const config = { firebaseApiKey: "key", firebaseAuthDomain: "x.firebaseapp.com", firebaseAppId: "app" };
const memoryStore = (initial: string | null): SessionStore & { value: string | null } => {
  const store = { value: initial, get: async () => store.value, set: async (v: string) => { store.value = v; }, clear: async () => { store.value = null; } };
  return store;
};
const ok = (json: unknown): ReturnType<FormPost> => Promise.resolve({ status: 200, json });

const complete = (port: number, body: unknown, origin = `http://localhost:${port}`) => fetch(`http://127.0.0.1:${port}/complete`,
  { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

const noAccept = () => Promise.resolve();
const pageOf = (address: string) => { const url = new URL(address); return { port: Number(url.port), state: url.pathname.split("/").pop() }; };
const closed = (port: number) => fetch(`http://127.0.0.1:${port}/`).then(() => false, () => true);
const ipv6Available = () => new Promise<boolean>((resolve) => {
  const probe = net.createServer();
  probe.once("error", () => resolve(false));
  probe.listen(0, "::1", () => probe.close(() => resolve(true)));
});

describe("uidOfToken", () => {
  const token = (payload: unknown) => `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
  it("reads the account from the token's payload", () => {
    expect(uidOfToken(token({ sub: "u1" }))).toBe("u1");
    expect(uidOfToken(token({ user_id: "u2" }))).toBe("u2");
  });
  it("says nothing about a token it cannot read", () => {
    expect(uidOfToken("nonsense")).toBeNull();
    expect(uidOfToken(token({ sub: 4 }))).toBeNull();
    expect(uidOfToken(token(null))).toBeNull();
  });
});

describe("browser sign-in server", () => {
  it("serves the page only at the one-time address, and stops once finished", async () => {
    const { port, session } = await waitForBrowserSignIn("good", "<p>page</p>", noAccept, 5000);
    expect(await (await fetch(`http://127.0.0.1:${port}/signin/good`)).text()).toBe("<p>page</p>");
    expect((await fetch(`http://127.0.0.1:${port}/signin/evil`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    await complete(port, { state: "good", refreshToken: "R" });
    await session;
    expect(await closed(port)).toBe(true);
  });

  it("holds both loopback addresses, so no other process can answer on localhost", async () => {
    const { port, cancel } = await waitForBrowserSignIn("good", "<p>page</p>", noAccept, 5000);
    if (await ipv6Available()) expect((await fetch(`http://[::1]:${port}/signin/good`)).status).toBe(200);
    cancel();
  });

  it("ignores a missing or other origin, a wrong state and an empty token, then still accepts the real page", async () => {
    const accept = vi.fn(noAccept);
    const { port, session } = await waitForBrowserSignIn("good", "", accept, 5000);
    expect((await complete(port, { state: "good", refreshToken: "evil" }, "https://evil.example")).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/complete`, { method: "POST", body: JSON.stringify({ state: "good", refreshToken: "evil" }) })).status).toBe(403);
    expect((await complete(port, { state: "evil", refreshToken: "evil" })).status).toBe(400);
    expect((await complete(port, { state: "good", refreshToken: "" })).status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
    expect((await complete(port, { state: "good", refreshToken: "R" })).status).toBe(200);
    await session;
    expect(accept).toHaveBeenCalledWith({ refreshToken: "R" });
  });

  it("tells the page only once the session is accepted", async () => {
    const refused = new Error("refused");
    const { port, session } = await waitForBrowserSignIn("good", "", () => Promise.reject(refused), 5000);
    expect((await complete(port, { state: "good", refreshToken: "R" })).status).toBe(400);
    await expect(session).rejects.toBe(refused);
  });

  it("times out when the writer never finishes, and stops", async () => {
    const { port, session } = await waitForBrowserSignIn("good", "", noAccept, 20);
    await expect(session).rejects.toMatchObject({ code: "cancelled" });
    expect(await closed(port)).toBe(true);
  });
});

describe("sign-in page", () => {
  it("carries the Firebase config and state, safely escaped", () => {
    const html = signInPageHtml({ ...config, firebaseAppId: "</script><script>alert(1)" }, "st");
    expect(html).toContain('"authDomain":"x.firebaseapp.com"');
    expect(html).toContain('const state = "st"');
    expect(html).not.toContain("</script><script>alert(1)");
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

  it("says sign-in is not set up when the Firebase web app is missing", async () => {
    const source = new TokenSource(() => ok({}), memoryStore(null), { ...config, firebaseAppId: "" });
    await expect(source.signIn(() => undefined)).rejects.toMatchObject({ code: "not_configured" });
  });

  it("signs in through the browser page and stores only a token Firebase accepted", async () => {
    const store = memoryStore(null);
    const source = new TokenSource(() => ok({ id_token: "I", refresh_token: "rotated", expires_in: "3600" }), store, config);
    await source.signIn((address) => { const { port, state } = pageOf(address); void complete(port, { state, refreshToken: "from-page" }); });
    expect(store.value).toBe("rotated");
    expect(await source.idToken()).toBe("I");
  });

  it("stores nothing when Firebase refuses the token the page sent, and the page is told", async () => {
    const store = memoryStore(null);
    const source = new TokenSource(() => Promise.resolve({ status: 400, json: { error: { message: "INVALID_REFRESH_TOKEN" } } }), store, config);
    let answered: Promise<Response> | undefined;
    await expect(source.signIn((address) => { const { port, state } = pageOf(address); answered = complete(port, { state, refreshToken: "forged" }); }))
      .rejects.toMatchObject({ code: "signed_out" });
    expect(store.value).toBeNull();
    expect((await answered!).status).toBe(400);
  });

  it("refuses to sign in over an existing session, so one account never inherits another's state", async () => {
    const store = memoryStore("R");
    const open = vi.fn();
    const source = new TokenSource(() => ok({}), store, config);
    await expect(source.signIn(open)).rejects.toMatchObject({ code: "failed" });
    expect(open).not.toHaveBeenCalled();
    expect(store.value).toBe("R");
  });

  it("a second sign-in replaces the first, whose tab can no longer finish", async () => {
    const store = memoryStore(null);
    const source = new TokenSource(() => ok({ id_token: "I", refresh_token: "second", expires_in: "3600" }), store, config);
    let first!: { port: number; state: string | undefined };
    let firstError: unknown;
    const opened = new Promise<void>((resolve) => { void source.signIn((a) => { first = pageOf(a); resolve(); }).catch((e: unknown) => { firstError = e; }); });
    await opened;
    await source.signIn((a) => { const { port, state } = pageOf(a); void complete(port, { state, refreshToken: "from-second" }); });
    expect(firstError).toMatchObject({ code: "superseded" });
    expect(await closed(first.port)).toBe(true);
    expect(store.value).toBe("second");
  });

  it("sign-out during a sign-in stops it and stores nothing", async () => {
    const store = memoryStore(null);
    const source = new TokenSource(() => ok({ id_token: "I", refresh_token: "R", expires_in: "3600" }), store, config);
    let page!: { port: number; state: string | undefined };
    let opened!: () => void;
    const ready = new Promise<void>((resolve) => { opened = resolve; });
    const pending = source.signIn((a) => { page = pageOf(a); opened(); });
    await ready;
    await source.signOut();
    await expect(pending).rejects.toMatchObject({ code: "superseded" });
    expect(await closed(page.port)).toBe(true);
    expect(store.value).toBeNull();
  });

  it("a sign-out while Firebase checks the token keeps it out of the store", async () => {
    const store = memoryStore(null);
    let answer!: (value: { status: number; json: unknown }) => void;
    let checking!: () => void;
    const reached = new Promise<void>((resolve) => { checking = resolve; });
    const source = new TokenSource(() => new Promise((resolve) => { answer = resolve; checking(); }), store, config);
    const pending = source.signIn((a) => { const { port, state } = pageOf(a); void complete(port, { state, refreshToken: "from-page" }).catch(() => undefined); });
    await reached;
    await source.signOut();
    answer({ status: 200, json: { id_token: "I", refresh_token: "R", expires_in: "3600" } });
    await expect(pending).rejects.toMatchObject({ code: "superseded" });
    expect(store.value).toBeNull();
  });

  it("parses a Firebase refresh answer", async () => {
    const tokens = await refreshFirebaseIdToken(() => ok({ id_token: "I", refresh_token: "R", expires_in: "60" }), config, "x");
    expect(tokens).toMatchObject({ idToken: "I", refreshToken: "R", expiresInSeconds: 60 });
  });
});
