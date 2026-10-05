"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolIcon } from "./studio-icons";
import type { StudioCommand } from "../desktop/menu-model";
import { Search, X } from "lucide-react";
import { COMMAND_DEFINITIONS } from "./command-registry";

export type ToolPaletteGroup = {
  id: string;
  label: string;
  description: string;
  tools: Array<{
    id: string;
    icon: string;
    label: string;
    shortcut: string;
  }>;
};

export default function ToolPalette({
  groups,
  activeTool,
  onSelect,
  onCommand,
  commandEnabled,
  onClose,
  autoFocusSearch = true,
}: {
  groups: ToolPaletteGroup[];
  activeTool: string;
  onSelect: (tool: string, workspace: string) => void;
  onCommand: (command: StudioCommand) => void;
  commandEnabled: (command: StudioCommand) => boolean;
  onClose: () => void;
  autoFocusSearch?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement;
    // Touch users often browse rather than search. Don't cover their tools with
    // the software keyboard until they actually tap the search field.
    (autoFocusSearch ? searchRef.current : dialogRef.current)?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [autoFocusSearch]);

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        tools: group.tools.filter((tool) => (
          `${tool.label} ${tool.shortcut} ${group.label}`.toLocaleLowerCase().includes(needle)
        )),
      }))
      .filter((group) => group.tools.length > 0);
  }, [groups, query]);

  const featuredCommands: { id: StudioCommand; icon: string; label: string; detail: string; shortcut: string }[] = [
    { id: "define-custom-shape", icon: "custom-shape", label: "Define Custom Shape", detail: "Save selected vector outline", shortcut: "" },
    { id: "select-subject", icon: "sel-sam", label: "Select Subject", detail: "AI selection", shortcut: "" },
    { id: "curves", icon: "tone", label: "Curves Adjustment", detail: "New adjustment layer", shortcut: "" },
    { id: "levels", icon: "tone", label: "Levels Adjustment", detail: "New adjustment layer", shortcut: "" },
    { id: "hsl", icon: "tone", label: "HSL Adjustment", detail: "New adjustment layer", shortcut: "" },
    { id: "history", icon: "content-move", label: "Version History", detail: "History branches", shortcut: "" },
    { id: "export", icon: "frame", label: "Export", detail: "Raster or Photoshop", shortcut: "⌘E" },
    { id: "mockups", icon: "frame", label: "Mockups", detail: "Art on merch, posters, sleeves · alpha", shortcut: "" },
    { id: "glyph-font-maker", icon: "text", label: "Glyph Font Maker", detail: "Draw your own font · alpha", shortcut: "" },
  ];
  const allCommands = Object.values(COMMAND_DEFINITIONS).map(definition => ({
    ...definition,
    icon: featuredCommands.find(command => command.id === definition.id)?.icon ?? "frame",
    detail: featuredCommands.find(command => command.id === definition.id)?.detail ?? "Application command",
  }));
  const commands = (query.trim() ? allCommands : allCommands.filter(command => featuredCommands.some(featured => featured.id === command.id))).filter((command) => !query.trim()
    || `${command.label} ${command.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <div className="tool-palette-scrim" onPointerDown={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="tool-palette"
        role="dialog"
        aria-modal="true"
        aria-label="All tools"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Keep tool-search navigation and button activation out of the canvas
          // shortcut listener (Enter there enters layer focus).
          event.stopPropagation();
          if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
          if (event.key === "ArrowDown" && event.target === searchRef.current) {
            event.preventDefault();
            dialogRef.current?.querySelector<HTMLButtonElement>(".tool-palette-groups button:not(:disabled)")?.focus();
          }
          if (event.key === "Tab") {
            const targets = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]') ?? [])];
            const first = targets[0]; const last = targets.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <header>
          <div>
            <span>Tool library</span>
            <strong>All tools</strong>
          </div>
          <button onClick={onClose} aria-label="Close tool library"><X size={18} /></button>
        </header>
        <label className="tool-palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tool or shortcut"
            aria-label="Find a tool or shortcut"
          />
          {query && <button onClick={() => setQuery("")} aria-label="Clear tool search"><X size={14} /></button>}
        </label>
        <div className="tool-palette-groups">
          {commands.length > 0 && (
            <section className="tool-palette-group tool-command-group">
              <header>
                <div><strong>Commands</strong><span>Actions and adjustments</span></div>
                <small>{commands.length}</small>
              </header>
              <div>
                {commands.map((command) => (
                  <button key={command.id} disabled={!commandEnabled(command.id)} onClick={() => onCommand(command.id)}>
                    <span className="tool-glyph"><ToolIcon id={command.icon} size={16} /></span>
                    <span><strong>{command.label}</strong><small>{command.detail}</small></span>
                    {command.shortcut && <kbd>{command.shortcut}</kbd>}
                  </button>
                ))}
              </div>
            </section>
          )}
          {visibleGroups.map((group) => (
            <section key={group.id} className="tool-palette-group">
              <header>
                <div>
                  <strong>{group.label}</strong>
                  <span>{group.description}</span>
                </div>
                <small>{group.tools.length}</small>
              </header>
              <div>
                {group.tools.map((tool) => (
                  <button
                    key={tool.id}
                    className={activeTool === tool.id ? "active" : ""}
                    onClick={() => onSelect(tool.id, group.id)}
                    aria-pressed={activeTool === tool.id}
                  >
                    <span className="tool-glyph" aria-hidden="true"><ToolIcon id={tool.id} size={16} /></span>
                    <span>
                      <strong>{tool.label}</strong>
                      <small>{group.label}</small>
                    </span>
                    <kbd>{tool.shortcut}</kbd>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {visibleGroups.length === 0 && commands.length === 0 && (
            <div className="tool-palette-empty">
              <span>⌕</span>
              <strong>No tools found</strong>
              <small>Try a tool name, workspace, or shortcut.</small>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
