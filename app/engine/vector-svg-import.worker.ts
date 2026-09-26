import { parseEditableSvg } from "./vector-svg-import";
self.onmessage = (event: MessageEvent<string>) => {
  try { self.postMessage({ result: parseEditableSvg(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "SVG import failed" }); }
};
