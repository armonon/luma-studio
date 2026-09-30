"use client";
import { saveStatusLabel } from "./save-status";

import { useRef, type ReactNode } from "react";
import { ChevronDown, Ellipsis, FolderOpen, Redo2, Save, Undo2, PanelsTopLeft, Users } from "lucide-react";
import type { StudioCommand } from "../desktop/menu-model";

export default function StudioTitlebar({
  desktop,
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
}: {
  desktop: boolean;
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
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const run = (action: () => void) => {
    menuRef.current?.removeAttribute("open");
    action();
  };

  return (
    <header className="spatial-topbar studio-titlebar">
      {desktop && <div className="desktop-titlebar-drag" data-tauri-drag-region="true" aria-hidden="true" />}
      <div className="studio-brand-area">
        <button className="studio-app-mark" onClick={onBack} aria-label="Back to Luma home">L</button>
        <strong className="studio-product-name">Luma Studio</strong>
      </div>

      <div className="studio-project-title">
        <strong>{projectName}</strong>
        <span aria-live="polite">{saveStatusLabel(saveState, dirty, projectSaving)}</span>
      </div>

      <div className="spatial-share-actions">
        {onReview && <button className="studio-icon-button" onClick={onReview} title="Shared layer editing (alpha)" aria-label="Start shared editing"><Users size={16} /></button>}
        {tabletControls && <div className="tablet-title-controls">{tabletControls}</div>}
        <button className="studio-header-button studio-workspace-button" onClick={() => onCommand("workspace-settings")} title="Workspaces & shortcuts" aria-label="Workspaces & shortcuts" disabled={!commandEnabled("workspace-settings")}><PanelsTopLeft size={15} /><span>Workspace</span></button>
        <span className="studio-action-divider" />
        <button className="studio-icon-button" onClick={() => onCommand("undo")} title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo || !commandEnabled("undo")}><Undo2 /></button>
        <button className="studio-icon-button" onClick={() => onCommand("redo")} title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo || !commandEnabled("redo")}><Redo2 /></button>
        <span className="studio-action-divider" />
        <button className="studio-header-button studio-fit-button" onClick={() => onCommand("zoom-fit")} disabled={!commandEnabled("zoom-fit")}>Fit</button>
        <span className="studio-zoom-readout">{zoom}%</span>
        <details ref={menuRef} className="studio-app-menu">
          <summary aria-label="More application actions"><Ellipsis /></summary>
          <div>
            <button onClick={() => run(() => onCommand("new-document"))} disabled={!commandEnabled("new-document")}><span>New document…</span><kbd>⌘N</kbd></button>
            <button onClick={() => run(() => onCommand("open"))} disabled={!commandEnabled("open")}><FolderOpen /><span>Open…</span><kbd>⌘O</kbd></button>
            <button onClick={() => run(() => onCommand("save"))} disabled={!commandEnabled("save")}><Save /><span>Save project</span><kbd>⌘S</kbd></button>
            <hr />
            <button className={filtersOpen ? "active" : ""} onClick={() => run(() => onCommand("filter-gallery"))} disabled={!commandEnabled("filter-gallery")}><span>Filters</span></button>
            <button onClick={() => run(() => onCommand("batch"))} disabled={!commandEnabled("batch")}><span>Batch processing</span></button>
            <button onClick={() => run(() => onCommand("history"))} disabled={!commandEnabled("history")}><span>Version history</span></button>
            <button onClick={() => run(() => onCommand("workspace-settings"))} disabled={!commandEnabled("workspace-settings")}><span>Workspaces & shortcuts</span></button>
          </div>
        </details>
        <button className={`spatial-export ${exportOpen ? "active" : ""}`} onClick={() => onCommand("export")} aria-haspopup="dialog" aria-expanded={exportOpen} disabled={!commandEnabled("export")}>
          Export <ChevronDown />
        </button>
      </div>
    </header>
  );
}
