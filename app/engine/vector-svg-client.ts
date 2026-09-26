import type { ImportedSvg } from "./vector-svg-import";
let active = false;
export function importSvgInWorker(source: string): Promise<ImportedSvg> {
  if (active) return Promise.reject(new Error("An SVG import is already running"));
  if (source.length > 2 * 1024 * 1024) return Promise.reject(new Error("Editable SVG import is limited to 2 MiB"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./vector-svg-import.worker.ts", import.meta.url), { type: "module" });
    active = true;
    let settled = false;
    const finish = () => { if (settled) return false; settled = true; clearTimeout(timer); worker.terminate(); active = false; return true; };
    const timer = setTimeout(() => { if (finish()) reject(new Error("SVG import exceeded the 5-second budget; document unchanged")); }, 5000);
    worker.onmessage = e => { if (finish()) { if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); } };
    worker.onerror = () => { if (finish()) reject(new Error("SVG worker failed; document unchanged")); };
    try { worker.postMessage(source); } catch (error) { finish(); reject(error); }
  });
}
