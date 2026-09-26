import { shapeTextOutlines } from "./text-shaping";
import { OUTLINE_LIMITS, validateOutlineText, outlineRunSegments } from "./text-outline-model";
import type { TextStyle } from "./document";

self.onmessage = async (event: MessageEvent<TextStyle>) => {
  try {
    const { selected } = validateOutlineText(event.data);
    const files = new Set([selected.file, ...(event.data.runs?.length ? outlineRunSegments(event.data).map(run => run.selected.file) : [])]);
    if (files.size > 4) throw new Error("Outlined lettering supports at most four font faces.");
    const fonts = new Map<string, ArrayBuffer>();
    for (const file of files) {
      const response = await fetch(`/fonts/${file}`);
      if (!response.ok) throw new Error("Bundled font unavailable. Reinstall the complete application.");
      if (Number(response.headers.get("content-length")) > OUTLINE_LIMITS.fontBytes) throw new Error("Font exceeds memory budget.");
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > OUTLINE_LIMITS.fontBytes) throw new Error("Font exceeds memory budget.");
      fonts.set(file, bytes);
    }
    const result = await shapeTextOutlines(event.data, fonts);
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Text shaping failed" }); }
};
