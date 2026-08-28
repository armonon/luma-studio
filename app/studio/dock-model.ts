import type { PanelDock, PanelId, PanelRegistry } from "./panel-registry";

export const DOCK_LAYOUT_VERSION = 2;
export const DOCK_LAYOUT_STORAGE_KEY = "luma.dock-layout.v2";

export type DockGroup = Readonly<{
  id: string;
  dock: Exclude<PanelDock, "floating">;
  panelIds: readonly PanelId[];
  activePanelId: PanelId;
  size: number;
  weight: number;
  collapsed: boolean;
}>;

export type FloatingPanel = Readonly<{
  panelId: PanelId;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type DockLayout = Readonly<{
  version: typeof DOCK_LAYOUT_VERSION;
  workspace: string;
  groups: readonly DockGroup[];
  floating: readonly FloatingPanel[];
  closed: readonly PanelId[];
}>;

export type BuiltInWorkspace = "Essentials" | "Photography" | "Painting";
export const BUILT_IN_WORKSPACES: BuiltInWorkspace[] = ["Essentials", "Photography", "Painting"];

export function defaultDockLayout(workspace: BuiltInWorkspace = "Essentials"): DockLayout {
  const topPanels: PanelId[] = workspace === "Painting" ? ["properties"] : ["properties", "neural"];
  return {
    version: DOCK_LAYOUT_VERSION,
    workspace,
    groups: [
      { id: "right-properties", dock: "right", panelIds: topPanels, activePanelId: "properties", size: 300, weight: 1, collapsed: false },
      { id: "right-layers", dock: "right", panelIds: ["layers"], activePanelId: "layers", size: 300, weight: workspace === "Photography" ? 0.85 : 1.1, collapsed: false },
    ],
    floating: [],
    closed: [],
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function withoutPanel(layout: DockLayout, panelId: PanelId): DockLayout {
  const groups = layout.groups.flatMap((group) => {
    if (!group.panelIds.includes(panelId)) return [group];
    const panelIds = group.panelIds.filter((id) => id !== panelId);
    if (!panelIds.length) return [];
    return [{ ...group, panelIds, activePanelId: group.activePanelId === panelId ? panelIds[0] : group.activePanelId }];
  });
  return {
    ...layout,
    groups,
    floating: layout.floating.filter((panel) => panel.panelId !== panelId),
    closed: layout.closed.filter((id) => id !== panelId),
  };
}

export function sanitizeDockLayout(value: unknown, registry: PanelRegistry): DockLayout {
  const fallback = defaultDockLayout();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<DockLayout>;
  if (candidate.version !== DOCK_LAYOUT_VERSION || !Array.isArray(candidate.groups)) return fallback;
  const known = new Set(registry.list().map(({ id }) => id));
  const groups: DockGroup[] = [];
  const mounted = new Set<PanelId>();
  for (const raw of candidate.groups) {
    if (!raw || typeof raw !== "object") continue;
    const dock = raw.dock === "left" || raw.dock === "bottom" ? raw.dock : "right";
    const rawIds: unknown[] = Array.isArray(raw.panelIds) ? raw.panelIds : [];
    const panelIds: PanelId[] = unique(rawIds.filter((id): id is PanelId => (
      typeof id === "string" && known.has(id as PanelId) && !mounted.has(id as PanelId)
    )));
    if (!panelIds.length) continue;
    panelIds.forEach((id) => mounted.add(id));
    const requestedActive = raw.activePanelId as PanelId;
    groups.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : `${dock}-${groups.length + 1}`,
      dock,
      panelIds,
      activePanelId: panelIds.includes(requestedActive) ? requestedActive : panelIds[0],
      size: clamp(Number(raw.size), dock === "bottom" ? 180 : 220, dock === "bottom" ? 720 : 680),
      weight: clamp(Number(raw.weight), 0.25, 4),
      collapsed: Boolean(raw.collapsed),
    });
  }
  const floating: FloatingPanel[] = [];
  if (Array.isArray(candidate.floating)) {
    for (const raw of candidate.floating) {
      if (!raw || typeof raw !== "object" || typeof raw.panelId !== "string") continue;
      const panelId = raw.panelId as PanelId;
      if (!known.has(panelId) || mounted.has(panelId)) continue;
      mounted.add(panelId);
      const definition = registry.require(panelId);
      floating.push({
        panelId,
        x: clamp(Number(raw.x), 0, 7680),
        y: clamp(Number(raw.y), 0, 4320),
        width: clamp(Number(raw.width), definition.minimumWidth, 1200),
        height: clamp(Number(raw.height), definition.minimumHeight, 1200),
      });
    }
  }
  const closed = unique((Array.isArray(candidate.closed) ? candidate.closed : []).filter((id): id is PanelId => (
    typeof id === "string" && known.has(id as PanelId) && !mounted.has(id as PanelId)
  )));
  return {
    version: DOCK_LAYOUT_VERSION,
    workspace: typeof candidate.workspace === "string" && candidate.workspace ? candidate.workspace : fallback.workspace,
    groups: groups.length ? groups : fallback.groups,
    floating,
    closed,
  };
}

export function selectDockPanel(layout: DockLayout, groupId: string, panelId: PanelId): DockLayout {
  return { ...layout, groups: layout.groups.map((group) => group.id === groupId && group.panelIds.includes(panelId)
    ? { ...group, activePanelId: panelId, collapsed: false } : group) };
}

export function reorderDockPanel(layout: DockLayout, groupId: string, panelId: PanelId, targetIndex: number): DockLayout {
  return { ...layout, groups: layout.groups.map((group) => {
    if (group.id !== groupId || !group.panelIds.includes(panelId)) return group;
    const panelIds = group.panelIds.filter((id) => id !== panelId);
    panelIds.splice(clamp(targetIndex, 0, panelIds.length), 0, panelId);
    return { ...group, panelIds };
  }) };
}

export function closeDockPanel(layout: DockLayout, panelId: PanelId): DockLayout {
  const next = withoutPanel(layout, panelId);
  return { ...next, closed: unique([...next.closed, panelId]) };
}

export function openDockPanel(layout: DockLayout, panelId: PanelId, registry: PanelRegistry): DockLayout {
  const group = layout.groups.find((candidate) => candidate.panelIds.includes(panelId));
  if (group) return selectDockPanel(layout, group.id, panelId);
  if (layout.floating.some((panel) => panel.panelId === panelId)) return layout;
  const definition = registry.require(panelId);
  const target = layout.groups.find((candidate) => candidate.dock === definition.defaultDock)
    ?? layout.groups.find((candidate) => candidate.dock === "right");
  if (target) return moveDockPanelToGroup(layout, panelId, target.id, target.panelIds.length);
  return splitDockPanel(layout, panelId, definition.defaultDock === "floating" ? "right" : definition.defaultDock, registry);
}

export function moveDockPanelToGroup(layout: DockLayout, panelId: PanelId, targetGroupId: string, targetIndex: number): DockLayout {
  const detached = withoutPanel(layout, panelId);
  const target = detached.groups.find((group) => group.id === targetGroupId);
  if (!target) return layout;
  return {
    ...detached,
    groups: detached.groups.map((group) => {
      if (group.id !== targetGroupId) return group;
      const panelIds = [...group.panelIds];
      panelIds.splice(clamp(targetIndex, 0, panelIds.length), 0, panelId);
      return { ...group, panelIds, activePanelId: panelId, collapsed: false };
    }),
  };
}

export function splitDockPanel(layout: DockLayout, panelId: PanelId, dock: Exclude<PanelDock, "floating">, registry: PanelRegistry): DockLayout {
  const detached = withoutPanel(layout, panelId);
  const definition = registry.require(panelId);
  const idBase = `${dock}-${panelId}`;
  let suffix = 1;
  while (detached.groups.some((group) => group.id === `${idBase}-${suffix}`)) suffix += 1;
  return {
    ...detached,
    groups: [...detached.groups, {
      id: `${idBase}-${suffix}`,
      dock,
      panelIds: [panelId],
      activePanelId: panelId,
      size: dock === "bottom" ? 260 : definition.preferredWidth,
      weight: 1,
      collapsed: false,
    }],
  };
}

export function moveDockPanel(layout: DockLayout, panelId: PanelId, targetDock: PanelDock, registry: PanelRegistry): DockLayout {
  if (targetDock !== "floating") {
    const target = layout.groups.find((group) => group.dock === targetDock);
    return target
      ? moveDockPanelToGroup(layout, panelId, target.id, target.panelIds.length)
      : splitDockPanel(layout, panelId, targetDock, registry);
  }
  const detached = withoutPanel(layout, panelId);
  const definition = registry.require(panelId);
  return {
    ...detached,
    floating: [...detached.floating, {
      panelId,
      x: 96,
      y: 96,
      width: definition.preferredWidth,
      height: Math.max(definition.minimumHeight, 360),
    }],
  };
}

export function moveFloatingPanel(layout: DockLayout, panelId: PanelId, x: number, y: number): DockLayout {
  return { ...layout, floating: layout.floating.map((panel) => panel.panelId === panelId
    ? { ...panel, x: clamp(x, 0, 7680), y: clamp(y, 0, 4320) } : panel) };
}

export function resizeFloatingPanel(layout: DockLayout, panelId: PanelId, width: number, height: number, registry: PanelRegistry): DockLayout {
  const definition = registry.require(panelId);
  return { ...layout, floating: layout.floating.map((panel) => panel.panelId === panelId
    ? { ...panel, width: clamp(width, definition.minimumWidth, 1200), height: clamp(height, definition.minimumHeight, 1200) }
    : panel) };
}

export function collapseDockGroup(layout: DockLayout, groupId: string, collapsed: boolean): DockLayout {
  return { ...layout, groups: layout.groups.map((group) => group.id === groupId ? { ...group, collapsed } : group) };
}

export function resizeDockGroup(layout: DockLayout, groupId: string, size: number): DockLayout {
  return { ...layout, groups: layout.groups.map((group) => group.id === groupId
    ? { ...group, size: clamp(size, group.dock === "bottom" ? 180 : 220, group.dock === "bottom" ? 720 : 680) }
    : group) };
}

export function resizeDockSplit(layout: DockLayout, groupId: string, weight: number): DockLayout {
  return { ...layout, groups: layout.groups.map((group) => group.id === groupId
    ? { ...group, weight: clamp(weight, 0.25, 4) } : group) };
}
