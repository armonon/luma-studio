"use client";
import { saveStatusLabel } from "./save-status";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, Ellipsis, FolderOpen, Redo2, Save, Undo2, PanelsTopLeft, Users } from "lucide-react";
import type { StudioCommand } from "../desktop/menu-model";

export default function StudioTitlebar({
  desktop,
  phone = false,
  tabletControls,
  projectName,
  saveState,
  dirty,
  projectSaving,
  zoom,
  canUndo,
  canRedo,
  exportOpen,
  filtersOpen,
  onBack,
  onCommand,
  commandEnabled,
  onReview,
  onInstall,
  suiteMenu = false,
  onFocusCanvas,
  recoveryUnavailable = false,
}: {
  desktop: boolean;
  phone?: boolean;
  tabletControls?: ReactNode;
  projectName: string;
  saveState: "saved" | "unsaved" | "saving" | "error";
  dirty: boolean;
  projectSaving: boolean;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  exportOpen: boolean;
  filtersOpen: boolean;
  onBack: () => void;
  onCommand: (command: StudioCommand) => void;
  commandEnabled: (command: StudioCommand) => boolean;
  onReview?: () => void;
  onInstall?: () => void;
  /** Render the shared thecreateco suite menu (filled in by suite.js). */
  suiteMenu?: boolean;
  onFocusCanvas?: () => void;
  recoveryUnavailable?: boolean;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  // Tablet and phone layouts hide the brand area; keep the menu reachable.
  const suiteInActions = phone || Boolean(tabletControls);
  const run = (action: () => void) => {
    menuRef.current?.removeAttribute("open");
    action();
  };

  return (
    <header className="spatial-topbar studio-titlebar">
      {desktop && <div className="desktop-titlebar-drag" data-tauri-drag-region="true" aria-hidden="true" />}
      <div className="studio-brand-area">
        {suiteMenu && !suiteInActions && <tcc-suite-menu className="studio-suite-menu" />}
        <button className="studio-app-mark" onClick={onBack} aria-label="Back to Luma home">L</button>
        <strong className="studio-product-name">Luma</strong>
      </div>

      <div className="studio-project-title">
        <strong>{projectName}</strong>
        <span aria-live="polite">{saveStatusLabel(saveState, dirty, projectSaving)}</span>
      </div>

      <div className="spatial-share-actions">
        {suiteMenu && suiteInActions && <tcc-suite-menu className="studio-suite-menu" />}
        {phone && <span className="studio-phone-brand" role="img" aria-label="Luma Studio" title="Luma Studio"><span className="studio-app-mark" aria-hidden="true">L</span></span>}
        {onReview && !phone && <button className="studio-icon-button" onClick={onReview} title="Shared layer editing (alpha)" aria-label="Start shared editing"><Users size={16} /></button>}
        {tabletControls && <div className="tablet-title-controls">{tabletControls}</div>}
        {phone && <button className="studio-icon-button studio-phone-save" onClick={() => onCommand("save")} aria-label="Save project" aria-describedby="phone-save-status" title={`Save project · ${saveStatusLabel(saveState, dirty, projectSaving)}`} aria-busy={projectSaving} data-save-state={saveState === "error" ? "error" : dirty ? "dirty" : "clean"} disabled={projectSaving || !commandEnabled("save")}><Save /><i aria-hidden="true" /></button>}
        <button className="studio-header-button studio-workspace-button" onClick={() => onCommand("workspace-settings")} title="Workspaces & shortcuts" aria-label="Workspaces & shortcuts" disabled={!commandEnabled("workspace-settings")}><PanelsTopLeft size={15} /><span>Workspace</span></button>
        <span className="studio-action-divider" />
        <button className="studio-icon-button" onClick={() => onCommand("undo")} title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo || !commandEnabled("undo")}><Undo2 /></button>
        <button className="studio-icon-button" onClick={() => onCommand("redo")} title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo || !commandEnabled("redo")}><Redo2 /></button>
        <span className="studio-action-divider" />
        <button className="studio-header-button studio-fit-button" onClick={() => onCommand("zoom-fit")} disabled={!commandEnabled("zoom-fit")}>Fit</button>
        <span className="studio-zoom-readout">{zoom}%</span>
        <details ref={menuRef} className="studio-app-menu" onKeyDown={event => {
          if (!menuRef.current?.open) return;
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault(); menuRef.current.removeAttribute("open");
            menuRef.current.querySelector("summary")?.focus();
          }
        }} onBlur={event => {
          // WebKit touch can blur the summary with no next focus target before
          // delivering the button click. Outside pointerdown handles that case.
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.removeAttribute("open");
        }}>
          <summary aria-label="More application actions"><Ellipsis /></summary>
          <div>
            {phone && <p className="phone-save-status" role="status">{saveStatusLabel(saveState, dirty, projectSaving)}</p>}
            <button onClick={() => run(() => onCommand("new-document"))} disabled={!commandEnabled("new-document")}><span>New document…</span><kbd>⌘N</kbd></button>
            <button onClick={() => run(() => onCommand("open"))} disabled={!commandEnabled("open")}><FolderOpen /><span>Open…</span><kbd>⌘O</kbd></button>
            <button onClick={() => run(() => onCommand("save"))} disabled={!commandEnabled("save")}><Save /><span>Save project</span><kbd>⌘S</kbd></button>
            {phone && <button onClick={() => run(() => onCommand("zoom-fit"))} disabled={!commandEnabled("zoom-fit")}><span>Fit canvas</span></button>}
            {phone && <button onClick={() => run(() => onCommand("close-document"))} disabled={!commandEnabled("close-document")}><span>Close document…</span></button>}
            {phone && onFocusCanvas && <button onClick={() => run(onFocusCanvas)}><span>Focus canvas</span></button>}
            {phone && onReview && <button onClick={() => run(onReview)}><Users /><span>Shared editing (alpha)</span></button>}
            <hr />
            <button className={filtersOpen ? "active" : ""} onClick={() => run(() => onCommand("filter-gallery"))} disabled={!commandEnabled("filter-gallery")}><span>Filters</span></button>
            <button onClick={() => run(() => onCommand("batch"))} disabled={!commandEnabled("batch")}><span>Batch processing</span></button>
            <button onClick={() => run(() => onCommand("mockups"))} disabled={!commandEnabled("mockups")}><span>Mockups</span><kbd>alpha</kbd></button>
            <button onClick={() => run(() => onCommand("glyph-font-maker"))} disabled={!commandEnabled("glyph-font-maker")}><span>Glyph font maker</span><kbd>alpha</kbd></button>
            <button onClick={() => run(() => onCommand("history"))} disabled={!commandEnabled("history")}><span>Version history</span></button>
            <button onClick={() => run(() => onCommand("workspace-settings"))} disabled={!commandEnabled("workspace-settings")}><span>Workspaces & shortcuts</span></button>
            {onInstall && <><hr /><button onClick={() => run(onInstall)}><span>Install Luma app</span><kbd>offline</kbd></button></>}
          </div>
        </details>
        <button className={`spatial-export ${exportOpen ? "active" : ""}`} onClick={() => onCommand("export")} aria-haspopup="dialog" aria-expanded={exportOpen} disabled={!commandEnabled("export")}>
          Export <ChevronDown />
        </button>
      </div>
      {phone && <div className="phone-document-status"><strong>{projectName}</strong><span id="phone-save-status" role="status" data-error={saveState === "error" || recoveryUnavailable}>{recoveryUnavailable && !projectSaving ? "Recovery unavailable · Save a copy" : saveStatusLabel(saveState, dirty, projectSaving)}</span></div>}
    </header>
  );
}
