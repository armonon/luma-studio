import type { NextConfig } from "next";

// Node-only optional imports that never execute in this app (see the stub).
// Without these aliases `next build` (npm run build:netlify) fails with
// "Module not found" for jsdom's internals (via Paper.js) and for `module`
// (via harfbuzzjs's Node branch).
const emptyModule = "./build/empty-module.cjs";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    // Match the optional Node-only aliases when using the webpack QA server.
    config.resolve.alias = {
      ...config.resolve.alias,
      "jsdom/lib/jsdom/living/generated/utils": false,
      ...(!isServer ? { module: false } : {}),
    };
    return config;
  },
  // Keep Next/Turbopack scoped to this project when the parent folder also
  // contains a lockfile (as it does in the desktop development workspace).
  turbopack: {
    root: process.cwd(),
    resolveAlias: {
      "jsdom/lib/jsdom/living/generated/utils": emptyModule,
      module: { browser: emptyModule },
    },
  },
};

export default nextConfig;
