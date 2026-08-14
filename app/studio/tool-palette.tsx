"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ToolIcon } from "./studio-icons";
import type { StudioCommand } from "../desktop/menu-model";

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
  onClose,
}: {
  groups: ToolPaletteGroup[];
  activeTool: string;
  onSelect: (tool: string, workspace: string) => void;
  onCommand: (command: StudioCommand) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

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

  const allCommands: { id: StudioCommand; icon: string; label: string; detail: string; shortcut: string }[] = [
    { id: "select-subject", icon: "sel-sam", label: "Select Subject", detail: "AI selection", shortcut: "" },
    { id: "curves", icon: "tone", label: "Curves Adjustment", detail: "New adjustment layer", shortcut: "" },
    { id: "levels", icon: "tone", label: "Levels Adjustment", detail: "New adjustment layer", shortcut: "" },
    { id: "history", icon: "content-move", label: "Version History", detail: "History branches", shortcut: "" },
    { id: "export", icon: "frame", label: "Export", detail: "Raster or Photoshop", shortcut: "⌘E" },
  ];
  const commands = allCommands.filter((command) => !query.trim()
    || `${command.label} ${command.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return (
    <div className="tool-palette-scrim" onPointerDown={onClose}>
      <section
        className="tool-palette"
        role="dialog"
        aria-modal="true"
        aria-label="All tools"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Tool library</span>
            <strong>All tools</strong>
          </div>
          <button onClick={onClose} aria-label="Close tool library">×</button>
        </header>
        <label className="tool-palette-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tool or shortcut"
            aria-label="Find a tool or shortcut"
          />
          {query && <button onClick={() => setQuery("")} aria-label="Clear tool search">×</button>}
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
                  <button key={command.id} onClick={() => onCommand(command.id)}>
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
