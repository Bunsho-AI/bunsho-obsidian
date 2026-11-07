import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const watch = process.argv[2] === "watch";
const stage = process.argv[2] === "stage";

// The bunsho-99f2f project, which the stage engine trusts. Public Firebase web config, as in src/lib/services/auth/authConfig.ts.
const STAGE = {
  BUNSHO_FIREBASE_API_KEY: "AIzaSyD8S4qO39iqUjWcjeb0_ZnCcxJFSO571Vo",
  BUNSHO_FIREBASE_AUTH_DOMAIN: "bunsho-99f2f.firebaseapp.com",
  BUNSHO_FIREBASE_APP_ID: "1:556265093550:web:18438c4df4883bc758703f",
  BUNSHO_ENGINE_URL: "https://engine-stage.bunsho.io",
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  loader: { ".png": "dataurl" }, // a plugin ships only main.js, manifest.json and styles.css, so images travel inside main.js
  // ws loads these optionally inside try/catch; Obsidian provides obsidian, electron and Node itself.
  external: ["obsidian", "electron", "bufferutil", "utf-8-validate", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  // Local-development overrides (see src/lib/services/auth/authConfig.ts). Unset variables become "" and the committed defaults apply.
  define: Object.fromEntries(["BUNSHO_FIREBASE_API_KEY", "BUNSHO_FIREBASE_AUTH_DOMAIN", "BUNSHO_FIREBASE_APP_ID", "BUNSHO_ENGINE_URL"]
    .map((name) => [`process.env.${name}`, JSON.stringify((stage ? STAGE[name] : process.env[name]) ?? "")])),
  sourcemap: production || stage ? false : "inline",
  minify: false, // the directory scanner compares a build from source with the release; keep it readable
  logLevel: "info",
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
