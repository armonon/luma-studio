/** The Creating Co. visual workspaces map to existing Luma tools and panels.
 * This is navigation only: it does not duplicate or replace the editor engine.
 */
import type { Tool, WorkspaceMode } from "./tool-registry";
import type { PanelId } from "./panel-registry";

export type CreativeSpace = "photo" | "design" | "create";
export type SpaceAction = "develop" | "retouch" | "mask" | "type" | "artboards" | "brand" | "paint" | "intelligence" | "automation";
export type EditorDestination = Readonly<{
  label: string;
  tool?: Tool;
  workspace?: WorkspaceMode;
  panel?: PanelId;
}>;

export const CREATIVE_SPACES: Readonly<Record<CreativeSpace, Readonly<{
  label: string;
  subtitle: string;
  entry: EditorDestination;
  actions: readonly SpaceAction[];
}>>> = {
  photo: {
    label: "Photo",
    subtitle: "Develop and retouch",
    entry: { label: "Develop", tool: "tone", workspace: "develop", panel: "properties" },
    actions: ["develop", "retouch", "mask"],
  },
  design: {
    label: "Design",
    subtitle: "Type, vector and layout",
    entry: { label: "Type", tool: "text", workspace: "vector", panel: "vector" },
    actions: ["type", "artboards", "brand"],
  },
  create: {
    label: "Create",
    subtitle: "Paint, assets and intelligence",
    entry: { label: "Paint", tool: "brush", workspace: "edit", panel: "assets" },
    actions: ["paint", "intelligence", "automation"],
  },
} as const;

export const CREATIVE_ACTIONS: Readonly<Record<SpaceAction, EditorDestination>> = {
  develop: { label: "Develop", tool: "tone", workspace: "develop", panel: "properties" },
  retouch: { label: "Retouch", tool: "heal", workspace: "retouch", panel: "properties" },
  mask: { label: "Masks", tool: "mask-add", workspace: "mask", panel: "mask" },
  type: { label: "Typography", tool: "text", workspace: "vector", panel: "vector" },
  artboards: { label: "Artboards", panel: "structure" },
  brand: { label: "Brand & campaign", panel: "campaign" },
  paint: { label: "Paint", tool: "brush", workspace: "edit", panel: "paint" },
  intelligence: { label: "Intelligence", panel: "neural" },
  automation: { label: "Automations", panel: "actions" },
} as const;

export function creativeSpaceForWorkspace(workspace: WorkspaceMode): CreativeSpace {
  if (["develop", "retouch", "mask", "select", "measure"].includes(workspace)) return "photo";
  if (["vector", "transform"].includes(workspace)) return "design";
  return "create";
}

export function spaceDestination(space: CreativeSpace): EditorDestination {
  return CREATIVE_SPACES[space].entry;
}

export function actionDestination(action: SpaceAction): EditorDestination {
  return CREATIVE_ACTIONS[action];
}
