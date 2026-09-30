import { defaultClientConditions, type Plugin } from "vite";

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
        // Neural runtime explicitly selects our paired local MJS/WASM files.
        // Avoid emitting ONNX's unused 25MB+ bundled WebGPU fallback as well.
        resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
        build: {
          // All supported production browsers implement modulepreload. Avoid
          // paying for Vite's compatibility shim on every studio visit.
          modulePreload: { polyfill: false },
          rolldownOptions: {
            output: {
              // Luma's renderer is split across several tightly-coupled local
              // modules. Let dynamic feature boundaries remain separate, but
              // merge small shared fragments so opening the studio does not
              // spend extra requests and compression dictionaries on 1–18 KB
              // chunks such as blend, color, document, and tile-store.
              codeSplitting: {
                minSize: 100_000,
                groups: [
                  {
                    name(moduleId: string) {
                      if (!moduleId.includes("node_modules")) return null;
                      return /\/node_modules\/(?:react|react-dom|scheduler)\//.test(moduleId)
                        ? "framework"
                        : null;
                    },
                  },
                  {
                    name: "luma-engine-core",
                    test: /\/app\/engine\/(?:document|layer-styles|blend|renderer|tile-store|color)\.ts$/,
                    includeDependenciesRecursively: true,
                  },
                ],
              },
            },
          },
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
