import type { TextStyle } from "./document";
import { validateOutlineText, type ShapedOutlines } from "./text-outline-model";
let active = 0;
/** Each job owns/terminates its WASM heap. Two concurrent bounded jobs, no backlog. */
export function computeTextOutlines(text: TextStyle, signal?: AbortSignal): Promise<ShapedOutlines> {
  validateOutlineText(text);
  if (signal?.aborted) return Promise.reject(new Error("Text shaping cancelled"));
  if (active >= 2) return Promise.reject(new Error("Text shaping is busy. Try again after the current preview finishes."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./text-shaping.worker.ts", import.meta.url), { type: "module" });
    active += 1; let settled = false;
    const finish = () => { if (settled) return false; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate(); active -= 1; return true; };
    const abort = () => { if (finish()) reject(new Error("Text shaping cancelled")); };
    const timer = setTimeout(() => { if (finish()) reject(new Error("Text shaping exceeded the 8-second budget; document unchanged")); }, 8000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => { if (finish()) { if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result); } };
    worker.onerror = () => { if (finish()) reject(new Error("Text shaping worker failed; document unchanged")); };
    try { worker.postMessage(text); } catch (error) { finish(); reject(error); }
  });
}
