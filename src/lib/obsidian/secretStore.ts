/** The sign-in lives in Obsidian's secret storage, never in data.json (which may be synced with the vault). */
import type { App } from "obsidian";
import type { SessionStore } from "@/lib/services/auth/authService";

const SECRET_ID = "bunsho-refresh-token";

export function secretSessionStore(app: App): SessionStore {
  const secrets = app.secretStorage;
  return {
    get: () => Promise.resolve(secrets.getSecret(SECRET_ID) || null),
    set: (value) => { secrets.setSecret(SECRET_ID, value); return Promise.resolve(); },
    clear: () => { secrets.setSecret(SECRET_ID, ""); return Promise.resolve(); },
  };
}

const OWNER_ID = "bunsho-session-owner";

/** Which account this machine's session is for, as a hash, so the right data shows offline. Not a credential: it only chooses local files. */
export function sessionOwnerStore(app: App): { get(): string | null; set(key: string): void; clear(): void } {
  return {
    get: () => app.secretStorage.getSecret(OWNER_ID) || null,
    set: (key) => app.secretStorage.setSecret(OWNER_ID, key),
    clear: () => app.secretStorage.setSecret(OWNER_ID, ""),
  };
}
