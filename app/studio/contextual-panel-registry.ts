import type { Layer } from "@/app/engine/document";

export type ContextualPanelId =
  | "campaign"
  | "document"
  | "channels"
  | "structure"
  | "assets"
  | "selection"
  | "mask"
  | "raw"
  | "curves"
  | "levels"
  | "hsl"
  | "pro-adjustment"
  | "tone"
  | "paint"
  | "vector"
  | "transform"
  | "measure"
  | "neural"
  | "actions";

export const CONTEXTUAL_PANEL_CHOICES: ReadonlyArray<{ id: ContextualPanelId; label: string }> = [
  { id: "campaign", label: "Campaign" },
  { id: "document", label: "Document & color" },
  { id: "channels", label: "Channels" },
  { id: "structure", label: "Comps & artboards" },
  { id: "assets", label: "Plugins & assets" },
  { id: "selection", label: "Selection" },
  { id: "neural", label: "Neural Lab" },
  { id: "actions", label: "Actions" },
];

export function panelForLayer(layer: Layer | null): ContextualPanelId | null {
  if (!layer) return null;
  if (layer.lettering3d || layer.mesh3d) return "vector";
  if (layer.raw) return "raw";
  switch (layer.kind) {
    case "adjustment-tone": return "tone";
    case "adjustment-curves": return "curves";
    case "adjustment-levels": return "levels";
    case "adjustment-hsl": return "hsl";
    case "adjustment-pro": return "pro-adjustment";
    case "text": case "shape": case "path": return "vector";
    default: return null;
  }
}

export function resolveContextualPanel({
  override,
  inspector,
  layer,
  workspace,
  hasSelection,
  maskFocused,
}: {
  override: ContextualPanelId | null;
  inspector: "layers" | "properties" | "ai";
  layer: Layer | null;
  workspace: string;
  hasSelection: boolean;
  maskFocused: boolean;
}): ContextualPanelId {
  if (override) return override;
  if (inspector === "ai") return "neural";
  if (maskFocused || workspace === "mask") return "mask";
  const layerPanel = panelForLayer(layer);
  if (layerPanel) return layerPanel;
  if (workspace === "select" || hasSelection) return "selection";
  if (workspace === "vector") return "vector";
  if (workspace === "transform") return "transform";
  if (workspace === "measure") return "measure";
  if (workspace === "edit" || workspace === "retouch") return "paint";
  return "document";
}

export function workspaceForLayer(layer: Layer | null) {
  const panel = panelForLayer(layer);
  if (panel === "raw" || panel === "tone" || panel === "curves" || panel === "levels" || panel === "hsl" || panel === "pro-adjustment") return "develop" as const;
  if (panel === "vector") return "vector" as const;
  return null;
}
