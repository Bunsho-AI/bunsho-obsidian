/** Engine addresses the plugin will send a sign-in token to: https anywhere, plain http only on this machine. */
export function acceptableEngineUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLocalEngine(value);
  } catch { return false; }
}

export function isLocalEngine(value: string): boolean {
  try { const url = new URL(value); return url.hostname === "localhost" || url.hostname === "127.0.0.1"; } catch { return false; }
}
