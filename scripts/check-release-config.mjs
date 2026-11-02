// Fails a release whose committed sign-in values are empty: such a build installs fine, but nobody can sign in.
// Env overrides are blanked on purpose. The directory scanner rebuilds from source, so only committed values count.
import esbuild from "esbuild";

const { outputFiles } = await esbuild.build({
  entryPoints: ["src/lib/services/auth/authConfig.ts"],
  bundle: true,
  format: "esm",
  write: false,
  define: Object.fromEntries(["BUNSHO_FIREBASE_API_KEY", "BUNSHO_GOOGLE_CLIENT_ID", "BUNSHO_GOOGLE_CLIENT_SECRET", "BUNSHO_ENGINE_URL"]
    .map((name) => [`process.env.${name}`, '""'])),
});
const source = Buffer.from(outputFiles[0].text).toString("base64");
const { AUTH_CONFIG, missingSignInValues } = await import(`data:text/javascript;base64,${source}`);

const missing = missingSignInValues(AUTH_CONFIG);
if (missing.length > 0) {
  console.error(`Not releasing: empty in src/lib/services/auth/authConfig.ts: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Committed sign-in values are present.");
