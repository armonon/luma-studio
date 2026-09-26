import { TOOL_REGISTRY, type Tool, type ToolCursorVisualKind } from "./tool-registry";

export type CursorSelectionMode = "replace" | "add" | "subtract" | "intersect";

export type DynamicCursorContext = {
  selectionMode?: CursorSelectionMode;
  shiftKey?: boolean;
  altKey?: boolean;
  captureSampling?: boolean;
  unavailableReason?: string | null;
  needsSourceSample?: boolean;
  size: number;
  hardness: number;
  roundness: number;
  angle: number;
  color: string;
};

export type DynamicCursorPresentation = {
  kind: ToolCursorVisualKind;
  glyph: string;
  readout: string;
  status: "ready" | "attention" | "unavailable";
  size: number;
  hardness: number;
  roundness: number;
  angle: number;
  color: string;
};

const GLYPHS: Record<ToolCursorVisualKind, string> = {
  precision: "+",
  move: "↖",
  brush: "",
  selection: "+",
  sample: "⌁",
  type: "I",
  path: "◇",
  transform: "⌜",
  fill: "▣",
  gradient: "◩",
};

export function cursorSelectionMode(
  preferred: CursorSelectionMode,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
): CursorSelectionMode {
  if (modifiers.shiftKey && modifiers.altKey) return "intersect";
  if (modifiers.altKey) return "subtract";
  if (modifiers.shiftKey) return "add";
  return preferred;
}

export function dynamicCursorPresentation(tool: Tool, context: DynamicCursorContext): DynamicCursorPresentation {
  const registered = TOOL_REGISTRY[tool].cursorVisual;
  const kind = context.captureSampling ? "sample" : registered;
  const selection = cursorSelectionMode(context.selectionMode ?? "replace", context);
  let glyph = GLYPHS[kind];
  let readout = "";
  let status: DynamicCursorPresentation["status"] = "ready";

  if (context.unavailableReason) {
    glyph = "!";
    readout = context.unavailableReason;
    status = "unavailable";
  } else if (context.needsSourceSample) {
    glyph = "⌥";
    readout = "Alt-click source";
    status = "attention";
  } else if (kind === "brush") {
    readout = `${Math.round(context.size)} px`;
  } else if (context.captureSampling) {
    readout = `${Math.round(context.size)} px sample`;
  } else if (kind === "selection") {
    const operation = { replace: "New", add: "Add", subtract: "Subtract", intersect: "Intersect" }[selection];
    glyph = { replace: "+", add: "+", subtract: "−", intersect: "∩" }[selection];
    readout = operation;
    if (selection !== "replace") status = "attention";
  } else {
    readout = TOOL_REGISTRY[tool].label;
  }

  return {
    kind,
    glyph,
    readout,
    status,
    size: Math.max(1, context.size),
    hardness: Math.max(0, Math.min(1, context.hardness)),
    roundness: Math.max(0.05, Math.min(1, context.roundness)),
    angle: Number.isFinite(context.angle) ? context.angle : 0,
    color: /^#[0-9a-f]{6}$/i.test(context.color) ? context.color : "#ffffff",
  };
}

export function cursorRingGeometry(input: {
  documentSize: number;
  viewportDocumentWidth: number;
  canvasCssWidth: number;
  pressure?: number;
  pressureSize?: boolean;
}) {
  const scale = input.canvasCssWidth > 0 && input.viewportDocumentWidth > 0
    ? input.canvasCssWidth / input.viewportDocumentWidth
    : 1;
  const pressure = input.pressureSize && input.pressure !== undefined
    ? Math.max(0.08, Math.min(1, input.pressure))
    : 1;
  const actualDiameter = Math.max(1, input.documentSize * scale * pressure);
  const displayDiameter = Math.max(6, Math.min(360, actualDiameter));
  return {
    actualDiameter,
    displayDiameter,
    clipped: actualDiameter > displayDiameter,
  };
}
