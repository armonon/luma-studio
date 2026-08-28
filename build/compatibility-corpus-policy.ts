export type PhotoshopImportMode = "layered" | "composite-only" | "flattened-fallback";

export function classifyPhotoshopImport(input: Readonly<{
  sourceLayers: number;
  openedLayers: number;
  minimumLayers?: number;
  allowFlattenedFallback?: boolean;
}>): PhotoshopImportMode {
  if (input.sourceLayers === 0) return "composite-only";
  const editableFloor = input.minimumLayers ?? Math.max(1, input.sourceLayers);
  if (input.openedLayers >= editableFloor) return "layered";
  if (input.allowFlattenedFallback) return "flattened-fallback";
  throw new Error(`editable import collapsed ${input.sourceLayers} source layers to ${input.openedLayers}; expected at least ${editableFloor}`);
}
