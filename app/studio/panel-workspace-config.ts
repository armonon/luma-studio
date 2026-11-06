import type { PanelId } from "./panel-registry";

type WorkspaceDefinition = Readonly<{
  description: string;
  related: readonly PanelId[];
  preview: boolean;
}>;

/** Expanded views use the same editor panels; this describes how they connect. */
export const PANEL_WORKSPACES = {
  layers: { description: "Organize, blend, and refine the document stack.", related: ["properties", "mask", "structure"], preview: true },
  properties: { description: "Inspect the selection and refine its appearance.", related: ["layers", "transform", "paint"], preview: true },
  neural: { description: "Set a target, compare results, and refine an AI edit.", related: ["selection", "mask", "history"], preview: true },
  document: { description: "Manage document size, color, proofing, and output intent.", related: ["channels", "campaign", "measure"], preview: true },
  channels: { description: "Inspect channels and build reusable alpha selections.", related: ["selection", "mask", "document"], preview: true },
  structure: { description: "Capture layer comps and arrange artboards.", related: ["layers", "campaign", "document"], preview: true },
  campaign: { description: "Build a brand system, variants, and deliverables.", related: ["structure", "vector", "document"], preview: true },
  assets: { description: "Find plugins, brushes, and reusable production assets.", related: ["paint", "campaign", "actions"], preview: false },
  selection: { description: "Build and refine the active selection.", related: ["mask", "channels", "neural"], preview: true },
  mask: { description: "Shape visibility with masks and edge controls.", related: ["selection", "layers", "channels"], preview: true },
  raw: { description: "Develop source pixels with non-destructive RAW controls.", related: ["tone", "curves", "document"], preview: true },
  curves: { description: "Shape tonal and color response with curves.", related: ["levels", "tone", "hsl"], preview: true },
  levels: { description: "Set black, white, and midtone points precisely.", related: ["curves", "tone", "hsl"], preview: true },
  hsl: { description: "Adjust hue, saturation, and lightness by range.", related: ["pro-adjustment", "tone", "curves"], preview: true },
  "pro-adjustment": { description: "Explore professional color and tonal adjustments.", related: ["hsl", "curves", "tone"], preview: true },
  tone: { description: "Balance exposure, contrast, and color.", related: ["raw", "curves", "hsl"], preview: true },
  paint: { description: "Choose and tune brushes while viewing your document.", related: ["properties", "layers", "actions"], preview: true },
  vector: { description: "Edit typography, paths, shapes, and spatial forms.", related: ["transform", "campaign", "properties"], preview: true },
  transform: { description: "Position, align, and size the selected content.", related: ["properties", "measure", "vector"], preview: true },
  measure: { description: "Read dimensions, samples, and layout evidence.", related: ["transform", "document", "channels"], preview: true },
  actions: { description: "Record, edit, and run repeatable workflows.", related: ["history", "assets", "campaign"], preview: false },
  history: { description: "Review edits, compare branches, and restore a version.", related: ["layers", "actions", "campaign"], preview: true },
} satisfies Record<PanelId, WorkspaceDefinition>;
