import type { Layer, TextStyle } from "../engine/document";
import type { Studio } from "../engine/studio";
import { outlinedVectorPath, validateOutlineText, type ShapedOutlines } from "../engine/text-outline-model";
import { vectorDeliveryProblem } from "../engine/vector-delivery";

export const TEXT_OUTLINE_COMMAND = { id: "type.createOutlines", label: "Create outlines", shortcut: "", disabledReason: textOutlineDisabledReason, execute: executeTextOutlines } as const;
export function textOutlineDisabledReason(layer?: Layer | null): string | null {
  if (!layer?.text || layer.kind !== "text") return "Select a text layer";
  if (layer.locked) return "Unlock the text layer";
  if (layer.text.spatial?.enabled) return "Disable 3D projection before creating flat outlines";
  const problem = vectorDeliveryProblem({ ...layer, path: { anchors: [], closed: true, fill: "#000000", stroke: "none", strokeWidth: 0 } });
  if (problem) return problem;
  try {
    const { style } = validateOutlineText(layer.text);
    if (layer.text.appearance || style.decoration !== "none") return "Remove text appearance stacks and decorations before outlining";
  } catch (error) { return error instanceof Error ? error.message : "Text cannot be outlined"; }
  return null;
}
export async function executeTextOutlines(studio: Studio, id: string, compute?: (text: TextStyle) => Promise<ShapedOutlines>) {
  const source = studio.findLayer(id), problem = textOutlineDisabledReason(source);
  if (!source?.text || problem) throw new Error(problem ?? "Text layer unavailable");
  const document = studio.doc, state = JSON.stringify(source);
  const text = structuredClone(source.text);
  const run = compute ?? (await import("../engine/text-shaping-client")).computeTextOutlines;
  const result = outlinedVectorPath(text, await run(text));
  if (studio.doc !== document || studio.findLayer(id) !== source || JSON.stringify(source) !== state) throw new Error("The document or source changed while shaping; outlines discarded.");
  return studio.addOutlinedText(result, id);
}
