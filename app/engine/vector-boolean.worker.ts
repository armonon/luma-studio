import { evaluateBoolean } from "./vector-boolean";

self.onmessage = (event: MessageEvent<Parameters<typeof evaluateBoolean>>) => {
  try { self.postMessage({ result: evaluateBoolean(...event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Boolean operation failed" }); }
};
