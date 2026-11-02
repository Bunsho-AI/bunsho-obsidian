import esbuild from "esbuild";
import { builtinModules } from "node:module";

const production = process.argv[2] === "production";
const watch = process.argv[2] === "watch";

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
  define: Object.fromEntries(["BUNSHO_FIREBASE_API_KEY", "BUNSHO_GOOGLE_CLIENT_ID", "BUNSHO_GOOGLE_CLIENT_SECRET", "BUNSHO_ENGINE_URL"]
    .map((name) => [`process.env.${name}`, JSON.stringify(process.env[name] ?? "")])),
  sourcemap: production ? false : "inline",
  minify: false, // the directory scanner compares a build from source with the release; keep it readable
  logLevel: "info",
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
