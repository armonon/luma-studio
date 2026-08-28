"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  closeDockPanel,
  collapseDockGroup,
  moveDockPanel,
  moveDockPanelToGroup,
  moveFloatingPanel,
  reorderDockPanel,
  resizeDockGroup,
  resizeDockSplit,
  resizeFloatingPanel,
  selectDockPanel,
  splitDockPanel,
  type DockGroup,
  type DockLayout,
  type FloatingPanel,
} from "./dock-model";
import { STUDIO_PANEL_REGISTRY, type PanelId } from "./panel-registry";

export function DockPanelContent({ children }: { panelId: PanelId; children: ReactNode }) {
  return <>{children}</>;
}

function collectPanelContent(node: ReactNode, result = new Map<PanelId, ReactNode[]>()) {
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === DockPanelContent) {
      const props = child.props as { panelId: PanelId; children: ReactNode };
      result.set(props.panelId, [...(result.get(props.panelId) ?? []), props.children]);
      return;
    }
    if (child.type === Fragment) collectPanelContent((child.props as { children?: ReactNode }).children, result);
  });
  return result;
}

function panelGlyph(panelId: PanelId) {
  if (panelId === "neural") return "✦";
  if (panelId === "layers") return "▱";
  if (panelId === "channels") return "◉";
  if (panelId === "actions") return "▶";
  return "⌘";
}

export default function DockManager({
  layout,
  onLayoutChange,
  onActivePanelChange,
  contextualPanel,
  children,
}: {
  layout: DockLayout;
  onLayoutChange: (layout: DockLayout) => void;
  onActivePanelChange: (panel: PanelId) => void;
  contextualPanel: PanelId;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const content = useMemo(() => collectPanelContent(children), [children]);

  const panelContent = (panelId: PanelId) => {
    const definition = STUDIO_PANEL_REGISTRY.require(panelId);
    const Component = definition.component;
    const nodes = panelId === "properties"
      ? [...(content.get("properties") ?? []), ...(content.get(contextualPanel) ?? [])]
      : content.get(panelId) ?? [];
    return (
      <Component>
        {nodes.length ? nodes : (
          <div className="dock-panel-empty">
            <strong>{definition.title}</strong>
            <span>This panel has no content for the current document.</span>
          </div>
        )}
      </Component>
    );
  };

  const activate = (group: DockGroup, panelId: PanelId) => {
    onLayoutChange(selectDockPanel(layout, group.id, panelId));
    onActivePanelChange(panelId);
  };

  const beginDockResize = (event: ReactPointerEvent<HTMLDivElement>, group: DockGroup) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = group.size;
    const onMove = (move: PointerEvent) => {
      const delta = group.dock === "left" ? move.clientX - startX
        : group.dock === "bottom" ? startY - move.clientY
          : startX - move.clientX;
      onLayoutChange(resizeDockGroup(layout, group.id, startSize + delta));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>, group: DockGroup) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = group.dock === "bottom" ? event.clientX : event.clientY;
    const startWeight = group.weight;
    const onMove = (move: PointerEvent) => {
      const current = group.dock === "bottom" ? move.clientX : move.clientY;
      onLayoutChange(resizeDockSplit(layout, group.id, startWeight + (current - start) / 180));
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const renderGroup = (group: DockGroup) => {
    const activePanelId = group.panelIds.includes(group.activePanelId) ? group.activePanelId : group.panelIds[0];
    const groupStyle = {
      "--dock-size": `${group.size}px`,
      "--dock-weight": group.collapsed ? 0 : group.weight,
    } as CSSProperties;
    return (
      <aside
        key={group.id}
        className="spatial-inspector dock-group"
        data-dock-active={activePanelId}
        data-context-panel={contextualPanel}
        data-dock-location={group.dock}
        data-collapsed={group.collapsed ? "true" : undefined}
        style={groupStyle}
      >
        <nav className="dock-tabbar" aria-label={`${group.dock} docked panels`}>
          <div className="dock-tabs" role="tablist">
            {group.panelIds.map((panelId, tabIndex) => {
              const panel = STUDIO_PANEL_REGISTRY.require(panelId);
              return (
                <div
                  className={activePanelId === panelId ? "active" : ""}
                  key={panelId}
                  draggable
                  onDragStart={(event) => { setDragging(panelId); event.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!dragging) return;
                    const sourceGroup = layout.groups.find((candidate) => candidate.panelIds.includes(dragging));
                    onLayoutChange(sourceGroup?.id === group.id
                      ? reorderDockPanel(layout, group.id, dragging, tabIndex)
                      : moveDockPanelToGroup(layout, dragging, group.id, tabIndex));
                    setDragging(null);
                  }}
                >
                  <button role="tab" aria-selected={activePanelId === panelId} onClick={() => activate(group, panelId)} title={panel.title}>
                    <span aria-hidden="true">{panelGlyph(panelId)}</span><strong>{panel.title}</strong>
                  </button>
                  {panel.closable && (
                    <button className="dock-tab-close" onClick={() => onLayoutChange(closeDockPanel(layout, panelId))} aria-label={`Close ${panel.title}`}>×</button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="dock-collapse"
            onClick={() => onLayoutChange(collapseDockGroup(layout, group.id, !group.collapsed))}
            aria-label={group.collapsed ? `Expand ${group.dock} panel group` : `Collapse ${group.dock} panel group`}
            aria-expanded={!group.collapsed}
          >{group.collapsed ? "+" : "−"}</button>
          <div className="dock-group-menu" data-open={menuGroupId === group.id ? "true" : undefined}>
            <button
              className="dock-group-menu-trigger"
              aria-label={`${STUDIO_PANEL_REGISTRY.require(activePanelId).title} panel options`}
              aria-expanded={menuGroupId === group.id}
              onClick={() => setMenuGroupId((current) => current === group.id ? null : group.id)}
            >•••</button>
            {menuGroupId === group.id && <div role="menu">
              <button role="menuitem" onClick={() => { setMenuGroupId(null); onLayoutChange(moveDockPanel(layout, activePanelId, "floating", STUDIO_PANEL_REGISTRY)); }}>Float panel</button>
              <button role="menuitem" onClick={() => { setMenuGroupId(null); onLayoutChange(splitDockPanel(layout, activePanelId, "left", STUDIO_PANEL_REGISTRY)); }}>Move to new left split</button>
              <button role="menuitem" onClick={() => { setMenuGroupId(null); onLayoutChange(splitDockPanel(layout, activePanelId, "right", STUDIO_PANEL_REGISTRY)); }}>Move to new right split</button>
              <button role="menuitem" onClick={() => { setMenuGroupId(null); onLayoutChange(splitDockPanel(layout, activePanelId, "bottom", STUDIO_PANEL_REGISTRY)); }}>Move to new bottom split</button>
              {STUDIO_PANEL_REGISTRY.require(activePanelId).closable && (
                <button role="menuitem" onClick={() => { setMenuGroupId(null); onLayoutChange(closeDockPanel(layout, activePanelId)); }}>Close panel</button>
              )}
            </div>}
          </div>
        </nav>
        {!group.collapsed && <div className="dock-panel-body">{panelContent(activePanelId)}</div>}
        {!group.collapsed && <div className={`dock-resizer dock-resizer-${group.dock}`} onPointerDown={(event) => beginDockResize(event, group)} aria-hidden="true" />}
        <div className={`dock-split-resizer dock-split-resizer-${group.dock}`} onPointerDown={(event) => beginSplitResize(event, group)} aria-hidden="true" />
      </aside>
    );
  };

  const renderFloating = (panel: FloatingPanel) => {
    const definition = STUDIO_PANEL_REGISTRY.require(panel.panelId);
    const beginMove = (event: ReactPointerEvent<HTMLElement>) => {
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = (move: PointerEvent) => onLayoutChange(moveFloatingPanel(layout, panel.panelId, panel.x + move.clientX - startX, panel.y + move.clientY - startY));
      const stop = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", stop); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
    };
    const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = (move: PointerEvent) => onLayoutChange(resizeFloatingPanel(layout, panel.panelId, panel.width + move.clientX - startX, panel.height + move.clientY - startY, STUDIO_PANEL_REGISTRY));
      const stop = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", stop); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
    };
    return (
      <aside key={panel.panelId} className="dock-floating-panel" style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}>
        <header onPointerDown={beginMove}>
          <span aria-hidden="true">{panelGlyph(panel.panelId)}</span><strong>{definition.title}</strong>
          <button onPointerDown={(event) => event.stopPropagation()} onClick={() => onLayoutChange(moveDockPanel(layout, panel.panelId, "right", STUDIO_PANEL_REGISTRY))}>Dock</button>
          <button onPointerDown={(event) => event.stopPropagation()} onClick={() => onLayoutChange(closeDockPanel(layout, panel.panelId))} aria-label={`Close ${definition.title}`}>×</button>
        </header>
        <div className="dock-panel-body">{panelContent(panel.panelId)}</div>
        <div className="dock-floating-resizer" onPointerDown={beginResize} aria-hidden="true" />
      </aside>
    );
  };

  const groupsFor = (dock: DockGroup["dock"]) => layout.groups.filter((group) => group.dock === dock);
  const hasDockedPanels = layout.groups.length > 0;

  return (
    <div className="dock-system" data-dragging={dragging ? "true" : undefined}>
      {(["left", "right", "bottom"] as const).map((dock) => {
        const groups = groupsFor(dock);
        if (!groups.length) return null;
        const size = Math.max(...groups.map((group) => group.size));
        return <div key={dock} className={`dock-stack dock-stack-${dock}`} style={{ "--dock-stack-size": `${size}px` } as CSSProperties}>{groups.map(renderGroup)}</div>;
      })}
      {layout.floating.map(renderFloating)}
      {!hasDockedPanels && !layout.floating.length && <aside className="dock-collapsed-rail" aria-label="Closed panels"><span>Panels closed</span></aside>}
      {dragging && (
        <div className="dock-drop-targets" aria-label="Dock targets">
          {(["left", "right", "bottom"] as const).map((dock) => (
            <button key={dock} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault();
              onLayoutChange(splitDockPanel(layout, dragging, dock, STUDIO_PANEL_REGISTRY));
              setDragging(null);
            }}>New {dock} split</button>
          ))}
          {layout.groups.map((group) => (
            <button key={group.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault();
              onLayoutChange(moveDockPanelToGroup(layout, dragging, group.id, group.panelIds.length));
              setDragging(null);
            }}>Join {group.dock} group</button>
          ))}
          <button onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault();
            onLayoutChange(moveDockPanel(layout, dragging, "floating", STUDIO_PANEL_REGISTRY));
            setDragging(null);
          }}>Float panel</button>
        </div>
      )}
    </div>
  );
}
