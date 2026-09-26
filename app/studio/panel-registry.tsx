"use client";

import type { ComponentType, ReactNode } from "react";
import type { ContextualPanelId } from "./contextual-panel-registry";

export type PrimaryPanelId = "layers" | "properties" | "neural";
export type PanelId = PrimaryPanelId | ContextualPanelId | "history";
export type PanelDock = "left" | "right" | "bottom" | "floating";

export type PanelComponentProps = Readonly<{ children?: ReactNode }>;
export type PanelDefinition = Readonly<{
  id: PanelId;
  title: string;
  icon: string;
  component: ComponentType<PanelComponentProps>;
  defaultDock: PanelDock;
  minimumWidth: number;
  preferredWidth: number;
  minimumHeight: number;
  singleton: boolean;
  closable: boolean;
  resizable: boolean;
}>;

function RegisteredPanelHost({ children }: PanelComponentProps) {
  return <>{children}</>;
}

export class PanelRegistry {
  readonly #panels = new Map<PanelId, PanelDefinition>();

  register(definition: PanelDefinition) {
    if (this.#panels.has(definition.id)) throw new Error(`Duplicate panel registration: ${definition.id}`);
    if (definition.minimumWidth <= 0 || definition.preferredWidth < definition.minimumWidth || definition.minimumHeight <= 0) {
      throw new Error(`Invalid panel dimensions: ${definition.id}`);
    }
    this.#panels.set(definition.id, Object.freeze({ ...definition }));
    return this;
  }

  get(id: PanelId) {
    return this.#panels.get(id);
  }

  require(id: PanelId) {
    const panel = this.get(id);
    if (!panel) throw new Error(`Unknown panel: ${id}`);
    return panel;
  }

  list() {
    return [...this.#panels.values()];
  }
}

const entries: ReadonlyArray<readonly [PanelId, string, string, PanelDock]> = [
  ["layers", "Layers", "layers", "right"],
  ["properties", "Properties", "sliders", "right"],
  ["neural", "Neural Lab", "sparkles", "right"],
  ["document", "Document & Color", "file-image", "right"],
  ["channels", "Channels", "channels", "right"],
  ["structure", "Layer Comps & Artboards", "layout", "right"],
  ["campaign", "Campaign", "palette", "right"],
  ["assets", "Plugins & Assets", "package", "right"],
  ["selection", "Selection", "scan", "right"],
  ["mask", "Masks", "circle-dashed", "right"],
  ["raw", "RAW Develop", "camera", "right"],
  ["curves", "Curves", "chart-spline", "right"],
  ["levels", "Levels", "chart-no-axes-column", "right"],
  ["hsl", "Hue / Saturation", "palette", "right"],
  ["pro-adjustment", "Professional Adjustment", "sliders-horizontal", "right"],
  ["tone", "Tone", "sun-medium", "right"],
  ["paint", "Brushes", "brush", "right"],
  ["vector", "Type & Vector", "pen-tool", "right"],
  ["transform", "Transform", "move-3d", "right"],
  ["measure", "Measure", "ruler", "right"],
  ["actions", "Actions", "play", "right"],
  ["history", "History", "history", "right"],
] as const;

export const STUDIO_PANEL_REGISTRY = entries.reduce((registry, [id, title, icon, defaultDock]) => (
  registry.register({
    id,
    title,
    icon,
    component: RegisteredPanelHost,
    defaultDock,
    minimumWidth: id === "layers" ? 240 : 260,
    preferredWidth: id === "layers" ? 286 : 300,
    minimumHeight: id === "layers" ? 220 : 160,
    singleton: true,
    closable: true,
    resizable: true,
  })
), new PanelRegistry());
