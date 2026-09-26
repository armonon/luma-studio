import type { Layer, PathStyle } from "../engine/document";
import type { Studio } from "../engine/studio";
import { documentContours, layerVectorPath, vectorDeliveryProblem } from "../engine/vector-delivery";
import { pathContours, vectorPaints, type BooleanOperation, type BooleanSource, type OffsetSource } from "../engine/vector-path";

export const VECTOR_COMMANDS = [
  { id: "unite", label: "Unite", description: "Combine both filled areas" },
  { id: "subtract", label: "Subtract", description: "Subtract the second operand from the selected layer" },
  { id: "intersect", label: "Intersect", description: "Keep only their shared area" },
  { id: "exclude", label: "Exclude", description: "Keep areas outside the overlap" },
] as const;

export function booleanDisabledReason(layer: Layer | null | undefined): string | null {
  if (!layer) return "Select a path or shape";
  if (layer.locked) return "Unlock the selected layer";
  if (layer.path?.symbolId) return "Detach the linked instance before boolean construction";
  if (layer.path?.appearance && !booleanSolidFill(layer.path)) return "Boolean construction requires one opaque solid fill without visible strokes";
  if (layer.path?.offsetSource) return "Expand the offset before boolean construction";
  return vectorDeliveryProblem(layer);
}

type Computer = (source: BooleanSource, appearance: Pick<PathStyle, "fill" | "stroke" | "strokeWidth">) => Promise<PathStyle>;
function booleanSolidFill(path: PathStyle): string | null {
  const paints = vectorPaints(path).filter(p => p.enabled && p.opacity > 0 && !["none", "transparent"].includes(p.color) && (p.kind !== "stroke" || p.width > 0));
  return paints.length === 1 && paints[0].kind === "fill" && paints[0].opacity === 1 ? paints[0].color : null;
}
export async function executeVectorOffset(studio: Studio, targetId: string, distance: number, join: OffsetSource["join"], compute?: (source: OffsetSource, path: PathStyle) => Promise<PathStyle>) {
  const target = studio.findLayer(targetId);
  if (!target || target.locked || target.path?.symbolId) throw new Error("Select an unlocked, detached vector layer");
  const problem = vectorDeliveryProblem(target); if (problem) throw new Error(problem);
  const document = studio.doc, before = JSON.stringify(target), path = layerVectorPath(target);
  const source: OffsetSource = { contours: structuredClone(path.offsetSource?.contours ?? pathContours(path)), fillRule: path.offsetSource?.fillRule ?? path.fillRule ?? "nonzero", distance, join };
  const run = compute ?? (await import("../engine/vector-offset-client")).computeOffset;
  const result = await run(source, path);
  if (studio.doc !== document || studio.findLayer(targetId) !== target || JSON.stringify(target) !== before) throw new Error("Document changed during offset calculation; result discarded");
  if (path.offsetSource) { studio.updatePath(targetId, result); return target; }
  return studio.addOffsetPath(result, targetId);
}

export async function executeVectorBoolean(studio: Studio, targetId: string, operandId: string | null, operation: BooleanOperation, compute?: Computer) {
  const target = studio.findLayer(targetId);
  const reason = booleanDisabledReason(target);
  if (reason || !target) throw new Error(reason ?? "Target no longer exists");
  const document = studio.doc;
  const before = JSON.stringify(target);
  const existing = target.path?.booleanSource;
  const operand = operandId ? studio.findLayer(operandId) : undefined;
  if (!existing && (!operand || operand.id === targetId)) throw new Error("Choose a different vector layer as the second operand");
  if (!existing && operand) { const problem = booleanDisabledReason(operand); if (problem) throw new Error(problem); }
  const operandBefore = operand ? JSON.stringify(operand) : null;
  const appearance = layerVectorPath(target);
  if (appearance.appearance) { appearance.fill = booleanSolidFill(appearance)!; appearance.stroke = "none"; appearance.strokeWidth = 0; }
  // New results use document-space geometry and intentionally take the first fill.
  // Reject non-unit opacities/strokes instead of silently changing their appearance.
  if (!existing && [target, operand!].some(layer => layer.opacity !== 1 || (layer.fillOpacity ?? 1) !== 1 || !booleanSolidFill(layerVectorPath(layer)))) throw new Error("Boolean construction currently requires opaque fills without strokes");
  const source: BooleanSource = { operation, operands: existing ? structuredClone(existing.operands) : [documentContours(target), documentContours(operand!)], fillRules: existing ? existing.fillRules : [appearance.fillRule ?? "nonzero", layerVectorPath(operand!).fillRule ?? "nonzero"] };
  const run = compute ?? (await import("../engine/vector-boolean-client")).computeBoolean;
  const result = await run(source, appearance);
  if (studio.doc !== document || studio.findLayer(targetId) !== target || JSON.stringify(target) !== before || operand && (studio.findLayer(operand.id) !== operand || JSON.stringify(operand) !== operandBefore)) throw new Error("Document or operands changed during calculation; result discarded");
  if (existing) { studio.updatePath(targetId, result); return target; }
  return studio.addBooleanPath(result, [targetId, operand!.id]);
}
