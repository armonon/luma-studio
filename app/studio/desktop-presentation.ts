import type { ToneParams } from "@/app/engine/document";

export type StudioPresentation = {
  workspace: "edit" | "transform";
  tool: "brush" | "radial-warp";
  assetsOpen: boolean;
  zoom: number;
  showRadialOverlay: boolean;
};

export const DESKTOP_TOOL_RAIL = [
  "move",
  "brush",
  "crop",
  "radial-warp",
  "heal",
  "sel-lasso",
  "sel-ellipse",
  "gradient",
  "erase",
  "text",
  "pen",
  "direct-select",
  "frame",
  "sel-sam",
] as const;

export const DESKTOP_DEMO_LAYERS: ReadonlyArray<{
  name: string;
  tone: Partial<ToneParams>;
}> = [
  { name: "Background", tone: {} },
  { name: "Foreground Detail", tone: { shadows: 3 } },
  { name: "Local Contrast", tone: { contrast: 4 } },
  { name: "Color Grade", tone: { temperature: 2 } },
  { name: "Sky Enhance", tone: { highlights: -3, vibrance: 3 } },
];

export function shouldRevealDesktopPassDeck({
  desktop,
  code,
  repeat,
  hasSelectedLayer,
  editingText,
}: {
  desktop: boolean;
  code: string;
  repeat: boolean;
  hasSelectedLayer: boolean;
  editingText: boolean;
}) {
  void hasSelectedLayer;
  return desktop
    && code === "Space"
    && !repeat
    && !editingText;
}

/** The native shell has purpose-built panels; do not mount CSS-hidden web UI. */
export function shouldMountLegacyInspector(desktop: boolean, nativeBuild = false) {
  return !desktop && !nativeBuild;
}

export function studioUiWorkPolicy({
  desktop,
  inspector,
  exportOpen,
  historyOpen,
  nativeBuild = false,
}: {
  desktop: boolean;
  inspector: "properties" | "layers" | "ai";
  exportOpen: boolean;
  historyOpen: boolean;
  nativeBuild?: boolean;
}) {
  return {
    engineDiagnostics: !desktop && !nativeBuild,
    photoshopPreflight: exportOpen || (!desktop && !nativeBuild && inspector === "properties"),
    historyTree: historyOpen || (!desktop && !nativeBuild),
  };
}

export function desktopRadialOverlayPosition({
  point,
  documentWidth,
  documentHeight,
  radius,
}: {
  point: { x: number; y: number } | null;
  documentWidth: number;
  documentHeight: number;
  radius: number;
}) {
  const x = point?.x ?? documentWidth * 0.34;
  const y = point?.y ?? documentHeight * 0.43;
  return {
    left: `${((x - radius) / documentWidth) * 100}%`,
    top: `${((y - radius) / documentHeight) * 100}%`,
  };
}

export function initialStudioPresentation(desktop: boolean): StudioPresentation {
  if (desktop) {
    return {
      workspace: "transform",
      tool: "radial-warp",
      assetsOpen: false,
      zoom: 1.55,
      showRadialOverlay: true,
    };
  }
  return {
    workspace: "edit",
    tool: "brush",
    assetsOpen: true,
    zoom: 1,
    showRadialOverlay: false,
  };
}
