/**
 * Build-time sign-in configuration. The Firebase web key is public by design (it ships in every Firebase web app and in the
 * desktop app's repo). The Google OAuth client is the plugin's own "Desktop app" client: Google documents the secret of an
 * installed-app client as non-confidential, which is what lets an open-source plugin carry it. Both are overridable at build
 * time for local development (BUNSHO_* env vars, see esbuild.config.mjs); the committed defaults are the production values.
 */
const pick = (override: string, fallback: string): string => (override ? override : fallback);

export const AUTH_CONFIG = {
  firebaseApiKey: pick(process.env.BUNSHO_FIREBASE_API_KEY ?? "", "AIzaSyDyhmbEZX8nFG7ol8GNu3C9WurBMiqXZFE"),
  /** Empty until the founder creates the plugin's OAuth client; sign-in then says it is not set up in this build. */
  googleClientId: pick(process.env.BUNSHO_GOOGLE_CLIENT_ID ?? "", ""),
  googleClientSecret: pick(process.env.BUNSHO_GOOGLE_CLIENT_SECRET ?? "", ""),
  engineUrl: pick(process.env.BUNSHO_ENGINE_URL ?? "", "https://engine.bunsho.io"),
} as const;
