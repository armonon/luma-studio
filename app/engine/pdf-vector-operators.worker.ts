import { pdfVectorOperators } from "./pdf-vector-operators";
self.onmessage = (event: MessageEvent<{ list: Parameters<typeof pdfVectorOperators>[0]; viewport: Parameters<typeof pdfVectorOperators>[1]; ops: Parameters<typeof pdfVectorOperators>[2] }>) => {
  try { self.postMessage({ result: pdfVectorOperators(event.data.list, event.data.viewport, event.data.ops) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "PDF vector conversion failed" }); }
};
