"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  onClose,
}: {
  groups: ToolPaletteGroup[];
  activeTool: string;
  onSelect: (tool: string, workspace: string) => void;
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
                    <span className="tool-glyph" aria-hidden="true">{tool.icon}</span>
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
          {visibleGroups.length === 0 && (
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
