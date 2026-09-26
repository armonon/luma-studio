import type { Document, Layer, LayerKind } from "./document";

export type ActionCondition =
  | { kind: "orientation"; value: "portrait" | "landscape" | "square"; not?: boolean }
  | { kind: "layer-kind"; value: LayerKind; not?: boolean }
  | { kind: "bit-depth"; value: 8 | 16 | 32; not?: boolean }
  | { kind: "selection" | "mask" | "locked"; value: boolean; not?: boolean };

export const ACTION_LAYER_KINDS: LayerKind[] = ["raster", "smart-object", "group", "adjustment-tone", "adjustment-curves", "adjustment-levels", "adjustment-hsl", "adjustment-pro", "text", "shape", "path"];

export function isActionCondition(value: unknown): value is ActionCondition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const condition = value as Record<string, unknown>;
  if (condition.not !== undefined && typeof condition.not !== "boolean") return false;
  switch (condition.kind) {
    case "orientation": return ["portrait", "landscape", "square"].includes(condition.value as string);
    case "layer-kind": return ACTION_LAYER_KINDS.includes(condition.value as LayerKind);
    case "bit-depth": return [8, 16, 32].includes(condition.value as number);
    case "selection": case "mask": case "locked": return typeof condition.value === "boolean";
    default: return false;
  }
}

export function actionConditionMatches(condition: ActionCondition, doc: Document, layer?: Layer) {
  let matches: boolean;
  switch (condition.kind) {
    case "orientation": matches = condition.value === (doc.width === doc.height ? "square" : doc.width > doc.height ? "landscape" : "portrait"); break;
    case "layer-kind": matches = layer?.kind === condition.value; break;
    case "bit-depth": matches = doc.bitDepth === condition.value; break;
    case "selection": matches = Boolean(doc.selection) === condition.value; break;
    // A missing target is not an unlocked or unmasked layer.
    case "mask": matches = Boolean(layer) && Boolean(layer?.mask || layer?.maskSurface) === condition.value; break;
    case "locked": matches = Boolean(layer) && Boolean(layer?.locked) === condition.value; break;
  }
  return condition.not ? !matches : matches;
}

export function describeActionCondition(condition: ActionCondition) {
  return `${condition.not ? "not " : ""}${condition.kind}: ${condition.value}`;
}
