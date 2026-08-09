import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "desktop",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  define: {
    "process.env": JSON.stringify({ NEXT_PUBLIC_LUMA_EDITION: "pro" }),
  },
  build: {
    outDir: "../dist-desktop",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
});
