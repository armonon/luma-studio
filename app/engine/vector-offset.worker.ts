import { evaluateOffset } from "./vector-offset";
self.onmessage = (event: MessageEvent<Parameters<typeof evaluateOffset>>) => {
  try { self.postMessage({ result: evaluateOffset(...event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Offset failed" }); }
};
