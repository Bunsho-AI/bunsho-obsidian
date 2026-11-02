/** Bunsho's own engines. `host` carries any non-default port, so another port on these names does not match. */
const BUNSHO_ENGINE_HOSTS = new Set(["engine.bunsho.io", "engine-stage.bunsho.io"]);

/** Engine addresses the plugin will send a sign-in token to: Bunsho's own over https, plain http only on this machine. */
export function acceptableEngineUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return BUNSHO_ENGINE_HOSTS.has(url.host);
    return url.protocol === "http:" && isLocalEngine(value);
  } catch { return false; }
}

export function isLocalEngine(value: string): boolean {
  try { const url = new URL(value); return url.hostname === "localhost" || url.hostname === "127.0.0.1"; } catch { return false; }
}
