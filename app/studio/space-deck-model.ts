import type { Layer } from "@/app/engine/document";

export type SpaceDeckContext =
  | "canvas"
  | "selection"
  | "mask"
  | "paint"
  | "retouch"
  | "text"
  | "develop"
  | "transform"
  | "measure"
  | "layer";

export type SpaceDeckCommandId =
  | "fit-canvas"
  | "new-layer"
  | "open-document"
  | "show-history"
  | "deselect"
  | "invert-selection"
  | "feather-selection"
  | "selection-ai"
  | "mask-reveal"
  | "mask-hide"
  | "invert-mask"
  | "focus-mask"
  | "brush-smaller"
  | "brush-larger"
  | "brush-softer"
  | "brush-harder"
  | "focus-layer"
  | "layer-style"
  | "toggle-visibility"
  | "toggle-lock";

export type SpaceDeckCommand = {
  id: SpaceDeckCommandId;
  label: string;
  detail: string;
  icon: string;
  key: number;
};

export type SpaceDeckModelInput = {
  layer: Layer | null;
  tool: string;
  hasSelection: boolean;
};

const PAINT_TOOLS = new Set(["brush", "capture-brush", "pencil", "mixer", "erase"]);
const RETOUCH_TOOLS = new Set([
  "clone", "heal", "spot-heal", "patch", "remove", "dodge", "burn", "blur-brush",
  "sharpen-brush", "smudge", "sponge", "liquify",
]);
const SELECTION_TOOLS = new Set([
  "sel-rect", "sel-ellipse", "sel-lasso", "sel-polygon", "sel-magnetic", "sel-quick",
  "sel-wand", "sel-sam",
]);
const TEXT_TOOLS = new Set([
  "text", "paragraph-text", "vertical-text", "path-text", "type-mask", "rect", "ellipse",
  "triangle", "polygon", "line", "custom-shape", "frame", "pen", "path-select", "direct-select",
]);
const TRANSFORM_TOOLS = new Set([
  "crop", "perspective-crop", "straighten", "content-move", "perspective-warp", "radial-warp",
]);
const MEASURE_TOOLS = new Set(["eyedropper", "color-sampler", "ruler"]);

export function resolveSpaceDeckContext({ layer, tool }: SpaceDeckModelInput): SpaceDeckContext {
  // The active tool is authoritative. A selection may exist while painting,
  // transforming or typing, but Space should still expose that tool's own
  // features instead of unexpectedly becoming a generic selection menu.
  if (SELECTION_TOOLS.has(tool)) return "selection";
  if (tool === "mask-add" || tool === "mask-remove") return "mask";
  if (PAINT_TOOLS.has(tool)) return "paint";
  if (RETOUCH_TOOLS.has(tool)) return "retouch";
  if (tool === "tone") return "develop";
  if (TEXT_TOOLS.has(tool)) return "text";
  if (TRANSFORM_TOOLS.has(tool)) return "transform";
  if (MEASURE_TOOLS.has(tool)) return "measure";
  if (layer) return "layer";
  return "canvas";
}

const command = (
  key: number,
  id: SpaceDeckCommandId,
  label: string,
  detail: string,
  icon: string,
): SpaceDeckCommand => ({ key, id, label, detail, icon });

export function spaceDeckCommands(input: SpaceDeckModelInput): SpaceDeckCommand[] {
  const context = resolveSpaceDeckContext(input);
  if (context === "selection") return [
    command(1, "deselect", "Deselect", "Release selection", "◇"),
    command(2, "invert-selection", "Invert", "Swap selected area", "◩"),
    command(3, "feather-selection", "Feather", "Soften the edge", "◌"),
    command(4, "selection-ai", "Refine", "Open neural masking", "✦"),
  ];
  if (context === "mask") return [
    command(1, "mask-reveal", "Reveal", "Paint mask in", "+"),
    command(2, "mask-hide", "Hide", "Paint mask out", "−"),
    command(3, "invert-mask", "Invert", "Reverse the mask", "◐"),
    command(4, "focus-mask", "Isolate", "Edit only the mask", "◎"),
  ];
  if (context === "paint" || context === "retouch") return [
    command(1, "brush-smaller", "Smaller", "Reduce tool radius", "["),
    command(2, "brush-larger", "Larger", "Increase tool radius", "]"),
    command(3, "brush-softer", "Softer", "Reduce edge hardness", "◌"),
    command(4, "brush-harder", "Harder", "Increase edge hardness", "●"),
  ];
  if (context === "canvas") return [
    command(1, "fit-canvas", "Fit", "Center the document", "⌗"),
    command(2, "new-layer", "New layer", "Add a paint layer", "+"),
    command(3, "open-document", "Open", "Import a document", "↗"),
    command(4, "show-history", "History", "Browse edit branches", "↶"),
  ];
  return [
    command(1, "focus-layer", "Focus", "Isolate this layer", "◎"),
    command(2, "layer-style", "Style", "Effects and blending", "fx"),
    command(3, "toggle-visibility", input.layer?.visible ? "Hide" : "Show", "Toggle visibility", "◉"),
    command(4, "toggle-lock", input.layer?.locked ? "Unlock" : "Lock", "Protect this layer", "⌁"),
  ];
}

/** Size the palette from its actual tool controls instead of reserving a large
 * fixed blend deck for every tool. */
export function spaceDeckDimensions(featureCount: number) {
  if (featureCount <= 3) return { width: 390, height: 260 };
  if (featureCount <= 5) return { width: 520, height: 326 };
  if (featureCount <= 8) return { width: 660, height: 390 };
  return { width: 740, height: 450 };
}

export function togglePinnedSpaceDeck(state: { open: boolean; pinned: boolean }) {
  return state.open && state.pinned
    ? { open: false, pinned: false }
    : { open: true, pinned: true };
}

export type SpaceDeckPoint = { x: number; y: number };

export function clampSpaceDeckPosition(
  point: SpaceDeckPoint,
  stage: { width: number; height: number },
  deck: { width: number; height: number } = { width: 560, height: 258 },
  margin = 14,
): SpaceDeckPoint {
  const maxX = Math.max(margin, stage.width - deck.width - margin);
  const maxY = Math.max(margin, stage.height - deck.height - margin);
  return {
    x: Math.max(margin, Math.min(maxX, point.x - deck.width / 2)),
    y: Math.max(margin, Math.min(maxY, point.y - deck.height / 2)),
  };
}

export function isEditableTextTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}
