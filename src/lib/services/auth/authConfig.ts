/**
 * Build-time sign-in configuration. Firebase web config is public by design: it ships in every Firebase web app and in the
 * desktop app's repo, and no Google client secret is involved. Values are overridable at build time (BUNSHO_* env vars or
 * `npm run build:stage`, see esbuild.config.mjs); the committed defaults are the production values.
 */
const pick = (override: string, fallback: string): string => (override ? override : fallback);

export const AUTH_CONFIG = {
  firebaseApiKey: pick(process.env.BUNSHO_FIREBASE_API_KEY ?? "", "AIzaSyDyhmbEZX8nFG7ol8GNu3C9WurBMiqXZFE"),
  firebaseAuthDomain: pick(process.env.BUNSHO_FIREBASE_AUTH_DOMAIN ?? "", "bunsho-prod.firebaseapp.com"),
  firebaseAppId: pick(process.env.BUNSHO_FIREBASE_APP_ID ?? "", "1:191491791774:web:341d0c7d70f108b9ca948f"),
  engineUrl: pick(process.env.BUNSHO_ENGINE_URL ?? "", "https://engine.bunsho.io"),
} as const;

type SignInValues = Pick<typeof AUTH_CONFIG, "firebaseApiKey" | "firebaseAuthDomain" | "firebaseAppId">;

/** The values a build cannot sign in without; the release workflow refuses to publish while any is empty. */
export function missingSignInValues(config: { [K in keyof SignInValues]: string }): (keyof SignInValues)[] {
  return (["firebaseApiKey", "firebaseAuthDomain", "firebaseAppId"] as const).filter((name) => !config[name]);
}
