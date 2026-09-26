import { pdfObjectOperators } from "./pdf-object-operators";
self.onmessage = event => {
  try {
    const { list, view, ops, fontFamily, fonts } = event.data;
    self.postMessage({ result: pdfObjectOperators(list, view, ops, fontFamily, fonts) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
