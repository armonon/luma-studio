"use client";
import { saveStatusLabel } from "./save-status";
import { CreativeSpaceSwitcher, CreativeAppearanceToggle } from "./creatingco-space-switcher";
import { CREATIVE_SPACES, type CreativeSpace, type SpaceAction } from "./creatingco-spaces";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, Ellipsis, FolderOpen, Redo2, Save, Undo2, Users, History, MoonStar, SunMedium, Check } from "lucide-react";
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
  creativeSpace = "create",
  onCreativeSpaceChange,
  onCreativeAction,
  appearance = "dark",
  onAppearanceChange,
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
  creativeSpace?: CreativeSpace;
  onCreativeSpaceChange?: (space: CreativeSpace) => void;
  onCreativeAction?: (action: SpaceAction) => void;
  appearance?: "dark" | "light";
  onAppearanceChange?: (appearance: "dark" | "light") => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = menuRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        if (details.contains(document.activeElement)) details.querySelector("summary")?.focus({ preventScroll: true });
        details.open = false;
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  // Tablet and phone layouts hide the brand area; keep the menu reachable.
  const suiteInActions = phone || Boolean(tabletControls);
  const run = (action: () => void) => {
    menuRef.current?.removeAttribute("open");
    // Restore the trigger before opening another surface so its own focus
    // restoration never points into this now-hidden menu.
    menuRef.current?.querySelector("summary")?.focus({ preventScroll: true });
    action();
  };

  return (
    <header className="spatial-topbar studio-titlebar">
      {desktop && <div className="desktop-titlebar-drag" data-tauri-drag-region="true" aria-hidden="true" />}
      <div className="studio-brand-area">
        {suiteMenu && !suiteInActions && <tcc-suite-menu className="studio-suite-menu" />}
        <button className="studio-app-mark" onClick={onBack} aria-label="Back to Luma home">L</button>
        <span className="creatingco-brand-lockup"><strong className="studio-product-name">Luma Studio</strong><small>by The Creating Co.</small></span>
      </div>

      {!phone && !tabletControls && onCreativeSpaceChange && onCreativeAction && (
        <CreativeSpaceSwitcher value={creativeSpace} onChange={onCreativeSpaceChange} onAction={onCreativeAction} />
      )}
      <div className="studio-project-title">
        <strong title={projectName}>{projectName}</strong>
        <span id={phone ? undefined : "studio-save-status"} aria-live="polite" data-save-state={saveState === "error" ? "error" : dirty ? "dirty" : "clean"}>{saveStatusLabel(saveState, dirty, projectSaving)}</span>
      </div>

      <div className="spatial-share-actions">
        {suiteMenu && suiteInActions && <tcc-suite-menu className="studio-suite-menu" />}
        {phone && <span className="studio-phone-brand" role="img" aria-label="Luma Studio" title="Luma Studio"><span className="studio-app-mark" aria-hidden="true">L</span></span>}
        {tabletControls && <div className="tablet-title-controls">{tabletControls}</div>}
        {phone && <button className="studio-icon-button studio-phone-save" onClick={() => onCommand("save")} aria-label="Save project" aria-describedby="phone-save-status" title={`Save project · ${saveStatusLabel(saveState, dirty, projectSaving)}`} aria-busy={projectSaving} data-save-state={saveState === "error" ? "error" : dirty ? "dirty" : "clean"} disabled={projectSaving || !commandEnabled("save")}><Save /><i aria-hidden="true" /></button>}
        {!phone && !tabletControls && <>
          <button className="studio-header-button studio-open-button" onClick={() => onCommand("open")} aria-label="Open document" title="Open document (⌘O)" disabled={!commandEnabled("open")}><FolderOpen size={16} aria-hidden="true" /><span>Open</span></button>
          <button className="studio-header-button studio-save-button" onClick={() => onCommand("save")} aria-label="Save project" aria-describedby="studio-save-status" title="Save project (⌘S)" aria-busy={projectSaving} data-save-state={saveState === "error" ? "error" : dirty ? "dirty" : "clean"} disabled={projectSaving || !commandEnabled("save")}><Save size={16} aria-hidden="true" /><span>{projectSaving ? "Saving…" : "Save"}</span></button>
          <span className="studio-action-divider" aria-hidden="true" />
        </>}
        {!phone && !tabletControls && <button className="studio-icon-button creatingco-history-button" onClick={() => onCommand("history")} title="Version history" aria-label="Open version history" disabled={!commandEnabled("history")}><History size={16} /></button>}
        <button className="studio-icon-button" onClick={() => onCommand("undo")} title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo || !commandEnabled("undo")}><Undo2 /></button>
        <button className="studio-icon-button" onClick={() => onCommand("redo")} title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!canRedo || !commandEnabled("redo")}><Redo2 /></button>
        <span className="studio-action-divider" aria-hidden="true" />
        <details ref={menuRef} className="studio-app-menu" onKeyDown={event => {
          const details = menuRef.current;
          if (!details) return;
          const summary = details.querySelector("summary");
          if (event.target === summary) event.stopPropagation();
          if (event.target === summary && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            details.open = true;
            const items = [...details.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            (event.key === "ArrowDown" ? items[0] : items.at(-1))?.focus();
            return;
          }
          if (!details.open) return;
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            details.open = false;
            summary?.focus();
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const items = [...details.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
        }} onBlur={event => {
          // WebKit touch can blur the summary before delivering a button click.
          // Outside pointerdown handles events without a next focus target.
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
        }}>
          <summary aria-label="More application actions" aria-haspopup="menu" title="More actions"><Ellipsis aria-hidden="true" /></summary>
          <div role="menu" aria-label="Application actions">
            {phone && <p className="phone-save-status" role="status">{saveStatusLabel(saveState, dirty, projectSaving)}</p>}
            <p className="studio-menu-section-label">Document</p>
            <button role="menuitem" onClick={() => run(() => onCommand("new-document"))} disabled={!commandEnabled("new-document")}><span>New document…</span><kbd>⌘N</kbd></button>
            <button role="menuitem" onClick={() => run(() => onCommand("open"))} disabled={!commandEnabled("open")}><FolderOpen /><span>Open…</span><kbd>⌘O</kbd></button>
            <button role="menuitem" onClick={() => run(() => onCommand("save"))} disabled={projectSaving || !commandEnabled("save")}><Save /><span>Save project</span><kbd>⌘S</kbd></button>
            <button role="menuitem" onClick={() => run(() => onCommand("close-document"))} disabled={!commandEnabled("close-document")}><span>Close document…</span></button>
            {(phone || tabletControls) && onCreativeSpaceChange && <>
              <hr />
              <p className="studio-menu-section-label">Creative workspace</p>
              {(["photo", "design", "create"] as const).map(space => <button key={space} role="menuitemradio" aria-checked={space === creativeSpace} onClick={() => run(() => onCreativeSpaceChange(space))}>
                <span>{CREATIVE_SPACES[space].label}</span>{space === creativeSpace && <Check size={16} aria-hidden="true" />}
              </button>)}
            </>}
            <hr />
            <p className="studio-menu-section-label">View & workspace</p>
            <button role="menuitem" onClick={() => run(() => onCommand("zoom-fit"))} disabled={!commandEnabled("zoom-fit")}><span>Fit canvas</span><kbd>{zoom}%</kbd></button>
            {phone && onFocusCanvas && <button role="menuitem" onClick={() => run(onFocusCanvas)}><span>Focus canvas</span></button>}
            <button role="menuitem" onClick={() => run(() => onCommand("history"))} disabled={!commandEnabled("history")}><History /><span>Version history</span></button>
            <button role="menuitem" onClick={() => run(() => onCommand("workspace-settings"))} disabled={!commandEnabled("workspace-settings")}><span>Panels & shortcuts</span></button>
            {(phone || tabletControls) && onAppearanceChange && <button role="menuitem" onClick={() => run(() => onAppearanceChange(appearance === "dark" ? "light" : "dark"))}>
              {appearance === "dark" ? <SunMedium /> : <MoonStar />}<span>{appearance === "dark" ? "Light appearance" : "Dark appearance"}</span>
            </button>}
            {onReview && <button role="menuitem" aria-label={phone ? undefined : "Start shared editing"} onClick={() => run(onReview)}><Users /><span>Shared editing (alpha)</span></button>}
            <hr />
            <p className="studio-menu-section-label">Creative tools</p>
            <button role="menuitem" className={filtersOpen ? "active" : ""} onClick={() => run(() => onCommand("filter-gallery"))} disabled={!commandEnabled("filter-gallery")}><span>Filters</span></button>
            <button role="menuitem" onClick={() => run(() => onCommand("batch"))} disabled={!commandEnabled("batch")}><span>Batch processing</span></button>
            <button role="menuitem" onClick={() => run(() => onCommand("mockups"))} disabled={!commandEnabled("mockups")}><span>Mockups</span><small>alpha</small></button>
            <button role="menuitem" onClick={() => run(() => onCommand("glyph-font-maker"))} disabled={!commandEnabled("glyph-font-maker")}><span>Glyph font maker</span><small>alpha</small></button>
            <button role="menuitem" onClick={() => run(() => onCommand("cutout"))} disabled={!commandEnabled("cutout")}><span>Cutout</span><small>alpha</small></button>
            <button role="menuitem" onClick={() => run(() => onCommand("upscale"))} disabled={!commandEnabled("upscale")}><span>Upscale…</span><small>alpha</small></button>
            <button role="menuitem" onClick={() => run(() => onCommand("thumb"))} disabled={!commandEnabled("thumb")}><span>Thumb…</span><small>alpha</small></button>
            {onInstall && <><hr /><button role="menuitem" onClick={() => run(onInstall)}><span>Install Luma app</span><small>offline</small></button></>}
          </div>
        </details>
        {!phone && !tabletControls && onAppearanceChange && <CreativeAppearanceToggle value={appearance} onChange={onAppearanceChange} />}
        <button className={`spatial-export ${exportOpen ? "active" : ""}`} onClick={() => onCommand("export")} aria-haspopup="dialog" aria-expanded={exportOpen} disabled={!commandEnabled("export")}>
          Export <ChevronDown />
        </button>
      </div>
      {phone && <div className="phone-document-status"><strong>{projectName}</strong><span id="phone-save-status" role="status" data-error={saveState === "error" || recoveryUnavailable}>{recoveryUnavailable && !projectSaving ? "Recovery unavailable · Save a copy" : saveStatusLabel(saveState, dirty, projectSaving)}</span></div>}
    </header>
  );
}
