import type { PathStyle } from "./document";
import { validateContours, type OffsetSource } from "./vector-path";
let active = false;
export function computeOffset(source: OffsetSource, appearance: PathStyle): Promise<PathStyle> {
  if (active) return Promise.reject(new Error("An offset calculation is already running"));
  return new Promise((resolve, reject) => {
    validateContours(source.contours, 512);
    const worker = new Worker(new URL("./vector-offset.worker.ts", import.meta.url), { type: "module" });
    active = true; let settled = false;
    const finish = () => { if (settled) return false; settled = true; clearTimeout(timer); worker.terminate(); active = false; return true; };
    const timer = setTimeout(() => { if (finish()) reject(new Error("Offset exceeded the 5-second budget; document unchanged")); }, 5000);
    worker.onmessage = e => { if (finish()) { if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); } };
    worker.onerror = () => { if (finish()) reject(new Error("Offset worker failed; document unchanged")); };
    try { worker.postMessage([source, appearance]); } catch (error) { finish(); reject(error); }
  });
}
