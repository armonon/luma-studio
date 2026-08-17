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
    __LUMA_NATIVE_DESKTOP__: "true",
  },
  build: {
    outDir: "../dist-desktop",
    emptyOutDir: true,
    target: "es2022",
    // Release diagnostics use native crash reporting and source revisions;
    // shipping 5+ MB of browser source maps only bloats the desktop payload.
    sourcemap: false,
  },
});
