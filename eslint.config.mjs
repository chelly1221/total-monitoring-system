import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src-tauri/target/**",
    "src-tauri/resources/**",
    "src-tauri/gen/**",
    "public/tv/vendor/**",
    ".review/**",
    // Separate Vite + Tauri project with its own tsconfig; linted on its own.
    "sound-client/**",
    "ping-client/**",
  ]),
  {
    files: ["scripts/**/*.{js,cjs}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The TV client targets ES5 browsers, which require a catch binding.
    files: ["public/tv/tv.js"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { caughtErrors: "none" }] },
  },
]);

export default eslintConfig;
