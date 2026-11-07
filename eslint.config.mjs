// Obsidian's official plugin guidelines linter (github.com/obsidianmd/eslint-plugin), recommended set.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "tests/**", "scripts/**", "esbuild.config.mjs", "vitest.config.ts"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ["eslint.config.*"] } },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["Bunsho", "Google", "Obsidian"] }],
    },
  },
  // validate-manifest reads manifest.json through the TypeScript parser; lint it on its own, without the type-aware rules.
  {
    files: ["manifest.json"],
    plugins: { obsidianmd },
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: false, project: null } },
    rules: { "obsidianmd/validate-manifest": "error" },
  },
]);
