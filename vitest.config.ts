import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    obsidian: fileURLToPath(new URL("./tests/stubs/obsidian.ts", import.meta.url)), // the real package only runs inside Obsidian
  } },
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup.ts"], coverage: { provider: "v8", include: ["src/**/*.ts"], exclude: ["src/**/index.ts", "src/assets/**"], reporter: ["text-summary", "json-summary", "text"] } },
});
