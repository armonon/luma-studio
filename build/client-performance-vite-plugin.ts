import type { Plugin } from "vite";

/**
 * Production-only client settings that are awkward to express through
 * NextConfig when Vinext owns the multi-environment Vite build.
 */
export function clientPerformance(): Plugin {
  return {
    name: "luma:client-performance",
    enforce: "post",
    configEnvironment(name) {
      if (name !== "client") return;

      return {
        build: {
          // All supported production browsers implement modulepreload. Avoid
          // paying for Vite's compatibility shim on every studio visit.
          modulePreload: { polyfill: false },
        },
      };
    },
    generateBundle(_options, bundle) {
      if (process.env.LUMA_BUNDLE_REPORT !== "1" || this.environment.name !== "client") return;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const modules = Object.entries(output.modules)
          .map(([id, module]) => ({ id, rendered: module.renderedLength }))
          .sort((a, b) => b.rendered - a.rendered)
          .slice(0, 12);
        console.log(`[bundle] ${output.fileName} ${output.code.length} bytes`);
        for (const module of modules) console.log(`  ${module.rendered}\t${module.id}`);
      }
    },
  };
}
