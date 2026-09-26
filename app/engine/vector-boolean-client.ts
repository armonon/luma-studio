import type { PathStyle } from "./document";
import { validateContours, VECTOR_LIMITS, type BooleanSource } from "./vector-path";

let activeJob = false;

export function computeBoolean(source: BooleanSource, appearance: Pick<PathStyle, "fill" | "stroke" | "strokeWidth">): Promise<PathStyle> {
  if (activeJob) return Promise.reject(new Error("A vector operation is already running; wait for it to finish"));
  return new Promise((resolve, reject) => {
    validateContours(source.operands.flat(), VECTOR_LIMITS.booleanAnchors);
    const worker = new Worker(new URL("./vector-boolean.worker.ts", import.meta.url), { type: "module" });
    activeJob = true;
    let settled = false;
    const timer = setTimeout(() => { if (finish()) reject(new Error("Boolean operation exceeded the 5-second budget. Simplify the paths and retry.")); }, 5000);
    const finish = () => {
      if (settled) return false;
      settled = true; clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.terminate(); activeJob = false; return true;
    };
    worker.onmessage = event => { if (!finish()) return; if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); };
    worker.onerror = () => { if (finish()) reject(new Error("Vector worker failed; document unchanged")); };
    try { worker.postMessage([source, appearance]); }
    catch (error) { finish(); reject(error); }
  });
}
