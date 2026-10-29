/** Shared pointer geometry, extracted from Luma af6f089 without algorithm changes. */
export type CursorSelectionMode = "replace" | "add" | "subtract" | "intersect";
export type CreativeCursorPhase = "ready" | "recognized" | "snap" | "pull" | "spin" | "processing";
export function creativeCursorCue(phase: CreativeCursorPhase) {
  const cues = { ready: {glyph:"",label:"Ready",shape:"round"}, recognized:{glyph:"◇",label:"Shape recognized",shape:"dashed"}, snap:{glyph:"+",label:"Aligned",shape:"square"}, pull:{glyph:"↥",label:"Pull along normal",shape:"direction"}, spin:{glyph:"↻",label:"Spin about axis",shape:"direction"}, processing:{glyph:"…",label:"Processing",shape:"dashed"} } as const;
  return cues[phase];
}
export function cursorSelectionMode(
  preferred: CursorSelectionMode,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
): CursorSelectionMode {
  if (modifiers.shiftKey && modifiers.altKey) return "intersect";
  if (modifiers.altKey) return "subtract";
  if (modifiers.shiftKey) return "add";
  return preferred;
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
