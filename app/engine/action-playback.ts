import type { ActionStep } from "./actions";
import type { Document, Layer } from "./document";

export type ActionStepResult = {
  index: number;
  operation: ActionStep["op"];
  targetId: string | null;
  status: "applied" | "unchanged" | "disabled" | "skipped" | "failed";
  message?: string;
};
export type ActionPlaybackReport = { name: string; documentId: string; targetId: string | null; completed: boolean; steps: ActionStepResult[] };
export class ActionPlaybackError extends Error {
  constructor(readonly report: ActionPlaybackReport) {
    const failure = report.steps.find(step => step.status === "failed");
    super(`${report.name}: step ${(failure?.index ?? 0) + 1} (${failure?.operation ?? "unknown"}) stopped: ${failure?.message ?? "unknown error"}. Earlier completed steps remain undoable.`);
    this.name = "ActionPlaybackError";
  }
}

/** Preconditions are evaluated immediately before EACH step, after target-changing steps. */
export function actionStepUnavailableReason(step: ActionStep, doc: Document, layer?: Layer): string | null {
  switch (step.op) {
    case "layerBatch": return null; // Targets and locks are checked by the bulk engine command.
    case "addAdjustment": case "addCurves": case "addLevels": case "addHsl":
    case "addProAdjustment": case "addRaster": case "addShape": case "addText":
    case "selectAll": case "deselect": case "invertSelection": return null;
    case "featherSelection": case "cropSelection":
      return doc.selection ? null : "This step requires a selection";
  }
  if (!layer) return "No active layer exists for this step";
  const byId = new Map(doc.layers.map(item => [item.id, item]));
  const seen = new Set<string>();
  let ancestor: Layer | undefined = layer;
  while (ancestor && !seen.has(ancestor.id)) {
    if (ancestor.locked) return `Layer or group “${ancestor.name}” is locked`;
    seen.add(ancestor.id); ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
  }
  switch (step.op) {
    case "fill": case "clear": case "invert": case "blur": case "sharpen": case "desaturate": case "hue": case "autoSubject":
      if (layer.kind !== "raster" || !layer.bitmap) return "This pixel operation requires a bitmap-backed raster layer";
      if (doc.bitDepth !== 8 || layer.raw) return "This pixel operation is not a lossless high-depth or RAW action; use an adjustment or smart filter";
      if (layer.bitmap.width * layer.bitmap.height > 16_000_000) return "This action's full-bitmap path exceeds its 16 MP safety limit";
      return null;
    case "convertSmartObject": return layer.kind === "raster" && !!layer.bitmap ? null : "Convert requires a bitmap-backed raster layer";
    case "groupActive": return layer.kind === "group" ? "The selected layer is already a group" : null;
    case "addSmartFilter": case "addDropShadow": return layer.kind === "group" || layer.kind.startsWith("adjustment-") ? "Select a content layer for this treatment" : null;
    case "invertMask": case "clearMask": return layer.mask || layer.maskSurface ? null : "The selected layer has no pixel mask";
    case "updateShape": return layer.kind === "shape" && layer.shape ? null : "This step requires a shape layer";
    case "updateText": return layer.kind === "text" && layer.text ? null : "This step requires a text layer";
    case "setTransform": return layer.kind === "group" ? "Group transforms are not supported; select a child layer" : null;
    case "duplicateActive": case "deleteActive":
    case "setOpacity": case "setFillOpacity": case "setBlendMode": return null;
    default: { const exhaustive: never = step; return `Unsupported action: ${String(exhaustive)}`; }
  }
}
