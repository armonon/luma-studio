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
    "dist/**",
    "dist-desktop/**",
    ".netlify/**",
    ".vinext/**",
    ".wrangler/**",
    "src-tauri/target/**",
    // Qualification archives, generated diagnostics and Rust outputs are not
    // maintained JS/TS source. Traversing them grows with every corpus run.
    "artifacts/**",
    "crates/**/target/**",
    "public/pdfjs/**",
    "public/onnxruntime/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
