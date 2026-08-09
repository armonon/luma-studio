"use client";

import { useEffect, useState } from "react";
import ToolPalette, { type ToolPaletteGroup } from "./tool-palette";

const PRIMARY_TOOL_COUNT = 6;

export function curatePrimaryTools<T extends { id: string }>(tools: T[], activeTool: string, limit = PRIMARY_TOOL_COUNT): T[] {
  const primary = tools.slice(0, limit);
  const active = tools.find((tool) => tool.id === activeTool);
  if (active && !primary.some((tool) => tool.id === active.id)) primary[limit - 1] = active;
  return primary;
}

export default function ToolDock({
  groups,
  activeWorkspace,
  activeTool,
  onSelect,
  onAiSelect,
}: {
  groups: ToolPaletteGroup[];
  activeWorkspace: string;
  activeTool: string;
  onSelect: (tool: string, workspace: string) => void;
  onAiSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const group = groups.find((entry) => entry.id === activeWorkspace) ?? groups[0];
  const primaryTools = curatePrimaryTools(group?.tools ?? [], activeTool);
  const hiddenCount = Math.max(0, (group?.tools.length ?? 0) - primaryTools.length);
  const total = groups.reduce((count, entry) => count + entry.tools.length, 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <aside className="spatial-toolbar" aria-label={`${activeWorkspace} tools`}>
        <div>
          <span className="tool-rail-heading">{group?.label ?? "Tools"}</span>
          {primaryTools.map((tool) => (
            <button
              key={tool.id}
              className={activeTool === tool.id ? "active" : ""}
              onClick={() => onSelect(tool.id, activeWorkspace)}
              aria-label={tool.label}
              aria-pressed={activeTool === tool.id}
              title={`${tool.label} (${tool.shortcut})`}
            >
              <span className="tool-glyph">{tool.icon}</span>
              <i>{tool.label}<kbd>{tool.shortcut}</kbd></i>
            </button>
          ))}
          <button
            className={`tool-library-trigger ${open ? "active" : ""}`}
            onClick={() => setOpen((value) => !value)}
            aria-label={`All tools, ${total} available`}
            aria-expanded={open}
            title={`All tools (${total})`}
          >
            <span className="tool-more-dots" aria-hidden="true"><i /><i /><i /></span>
            <i>All tools{hiddenCount > 0 && <kbd>+{hiddenCount}</kbd>}</i>
            {hiddenCount > 0 && <b>{hiddenCount}</b>}
          </button>
        </div>
        <button className="layers-orb" onClick={onAiSelect} aria-label="AI subject selection" title="AI subject selection">✦</button>
      </aside>
      {open && (
        <ToolPalette
          groups={groups}
          activeTool={activeTool}
          onSelect={(tool, workspace) => {
            onSelect(tool, workspace);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
