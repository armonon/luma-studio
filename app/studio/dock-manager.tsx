"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useState,
  useEffect,
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
import PanelIcon from "./panel-icon";
import { PanelErrorBoundary } from "./panel-error-boundary";
import { ChevronDown, ChevronUp, Ellipsis, X } from "lucide-react";
import { TabletPanel } from "./tablet-panel";

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

export default function DockManager({
  layout,
  onLayoutChange,
  onActivePanelChange,
  contextualPanel,
  tablet,
  children,
}: {
  layout: DockLayout;
  onLayoutChange: (layout: DockLayout) => void;
  onActivePanelChange: (panel: PanelId) => void;
  contextualPanel: PanelId;
  tablet?: { panel: PanelId | null; select: (panel: PanelId) => void; close: () => void };
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState<PanelId | null>(null);
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const content = useMemo(() => collectPanelContent(children), [children]);
  useEffect(() => {
    if (!menuGroupId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuGroupId(null); };
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Element && !event.target.closest(".dock-group-menu")) setMenuGroupId(null); };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => { window.removeEventListener("keydown", closeOnEscape); window.removeEventListener("pointerdown", closeOutside); };
  }, [menuGroupId]);

  const panelContent = (panelId: PanelId) => {
    const definition = STUDIO_PANEL_REGISTRY.require(panelId);
    const Component = definition.component;
    const candidates = panelId === "properties"
      ? [...(content.get("properties") ?? []), ...(content.get(contextualPanel) ?? [])]
      : content.get(panelId) ?? [];
    const nodes = Children.toArray(candidates);
    return (
      <PanelErrorBoundary key={`${panelId}:${panelId === "properties" ? contextualPanel : panelId}`} title={definition.title}>
      <Component>
        {nodes.length ? nodes : (
          <div className="dock-panel-empty">
            <strong>{definition.title}</strong>
            <span>This panel has no content for the current document.</span>
          </div>
        )}
      </Component>
      </PanelErrorBoundary>
    );
  };

  const activate = (group: DockGroup, panelId: PanelId) => {
    onLayoutChange(selectDockPanel(layout, group.id, panelId));
    onActivePanelChange(panelId);
  };

  const beginDockResize = (event: ReactPointerEvent<HTMLDivElement>, group: DockGroup) => {
    if (event.button !== 0) return;
    event.preventDefault();
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
    if (event.button !== 0) return;
    event.preventDefault();
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
                  <button role="tab" id={`dock-tab-${group.id}-${panelId}`} aria-controls={`dock-body-${group.id}`} tabIndex={activePanelId === panelId ? 0 : -1} aria-selected={activePanelId === panelId} onClick={() => activate(group, panelId)} title={panel.title}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? group.panelIds.length - 1
                        : (tabIndex + (event.key === "ArrowRight" ? 1 : -1) + group.panelIds.length) % group.panelIds.length;
                      activate(group, group.panelIds[nextIndex]);
                      event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
                    }}>
                    <PanelIcon name={panel.icon} /><strong>{panel.title}</strong>
                  </button>
                  {panel.closable && (
                    <button className="dock-tab-close" onClick={() => onLayoutChange(closeDockPanel(layout, panelId))} aria-label={`Close ${panel.title}`}><X size={12} /></button>
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
          >{group.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
          <div className="dock-group-menu" data-open={menuGroupId === group.id ? "true" : undefined}>
            <button
              className="dock-group-menu-trigger"
              aria-label={`${STUDIO_PANEL_REGISTRY.require(activePanelId).title} panel options`}
              aria-expanded={menuGroupId === group.id}
              onClick={() => setMenuGroupId((current) => current === group.id ? null : group.id)}
            ><Ellipsis size={16} /></button>
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
        {!group.collapsed && <div className="dock-panel-body" id={`dock-body-${group.id}`} role="tabpanel" aria-labelledby={`dock-tab-${group.id}-${activePanelId}`}>{panelContent(activePanelId)}</div>}
        {!group.collapsed && <div className={`dock-resizer dock-resizer-${group.dock}`} onPointerDown={(event) => beginDockResize(event, group)} aria-hidden="true" />}
        <div className={`dock-split-resizer dock-split-resizer-${group.dock}`} onPointerDown={(event) => beginSplitResize(event, group)} aria-hidden="true" />
      </aside>
    );
  };

  const renderFloating = (panel: FloatingPanel) => {
    const definition = STUDIO_PANEL_REGISTRY.require(panel.panelId);
    const beginMove = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = (move: PointerEvent) => onLayoutChange(moveFloatingPanel(layout, panel.panelId, panel.x + move.clientX - startX, panel.y + move.clientY - startY));
      const stop = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    };
    const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const onMove = (move: PointerEvent) => onLayoutChange(resizeFloatingPanel(layout, panel.panelId, panel.width + move.clientX - startX, panel.height + move.clientY - startY, STUDIO_PANEL_REGISTRY));
      const stop = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    };
    return (
      <aside key={panel.panelId} className="dock-floating-panel" style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}>
        <header onPointerDown={beginMove}>
          <PanelIcon name={definition.icon} /><strong>{definition.title}</strong>
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

  if (tablet) return tablet.panel ? <TabletPanel panel={tablet.panel} onSelect={tablet.select} onClose={tablet.close}>{panelContent(tablet.panel)}</TabletPanel> : null;

  return (
    <div className="dock-system" data-dragging={dragging ? "true" : undefined}>
      {(["left", "right", "bottom"] as const).map((dock) => {
        const groups = groupsFor(dock);
        if (!groups.length) return null;
        const rail = dock !== "bottom" && groups.every(group => group.collapsed);
        if (rail) return <nav key={dock} className={`dock-stack dock-stack-${dock} dock-icon-rail`} aria-label={`${dock} collapsed panels`} style={{ "--dock-stack-size": "40px" } as CSSProperties}>
          {groups.flatMap(group => group.panelIds.map(panelId => {
            const panel = STUDIO_PANEL_REGISTRY.require(panelId);
            return <button key={panelId} title={`Open ${panel.title}`} aria-label={`Open ${panel.title} panel`} onClick={() => {
              onLayoutChange(selectDockPanel(collapseDockGroup(layout, group.id, false), group.id, panelId));
              onActivePanelChange(panelId);
            }}><PanelIcon name={panel.icon} /></button>;
          }))}
        </nav>;
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
