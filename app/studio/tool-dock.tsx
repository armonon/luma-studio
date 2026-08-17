"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ToolPalette, { type ToolPaletteGroup } from "./tool-palette";
import { CategoryIcon, ToolIcon } from "./studio-icons";
import type { StudioCommand } from "../desktop/menu-model";
import { DESKTOP_TOOL_RAIL } from "./desktop-presentation";

type CategoryId = "move" | "paint" | "select" | "retouch" | "create" | "ai";

const categories: ReadonlyArray<{ id: CategoryId; label: string; tools: readonly string[] }> = [
  { id: "move", label: "Move", tools: ["move", "crop", "perspective-crop", "straighten", "content-move", "perspective-warp", "radial-warp", "ruler"] },
  { id: "paint", label: "Paint", tools: ["brush", "capture-brush", "pencil", "mixer", "erase", "gradient", "pattern", "fill", "mask-add", "mask-remove"] },
  { id: "select", label: "Select", tools: ["sel-rect", "sel-ellipse", "sel-lasso", "sel-polygon", "sel-magnetic", "sel-quick", "sel-wand"] },
  { id: "retouch", label: "Retouch", tools: ["heal", "clone", "spot-heal", "patch", "remove", "dodge", "burn", "blur-brush", "sharpen-brush", "smudge", "sponge", "liquify"] },
  { id: "create", label: "Create", tools: ["text", "paragraph-text", "vertical-text", "path-text", "type-mask", "rect", "ellipse", "triangle", "polygon", "line", "custom-shape", "frame", "pen", "path-select", "direct-select"] },
  { id: "ai", label: "AI", tools: ["sel-sam"] },
];

export function categoryForTool(tool: string): CategoryId | null {
  return categories.find((category) => category.tools.includes(tool))?.id ?? null;
}

export default function ToolDock({
  groups,
  activeTool,
  onSelect,
  onAiSelect,
  onCommand,
  compactDesktop = false,
}: {
  groups: ToolPaletteGroup[];
  activeWorkspace: string;
  activeTool: string;
  onSelect: (tool: string, workspace: string) => void;
  onAiSelect: () => void;
  onCommand: (command: StudioCommand) => void;
  compactDesktop?: boolean;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [flyout, setFlyout] = useState<CategoryId | null>(null);
  const [recent, setRecent] = useState<Record<string, string>>({});
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tools = useMemo(() => groups.flatMap((group) => group.tools.map((tool) => ({ ...tool, workspace: group.id }))), [groups]);
  const activeCategory = categoryForTool(activeTool);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLibraryOpen(true);
        setFlyout(null);
      }
      if (event.key === "Escape") {
        setLibraryOpen(false);
        setFlyout(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const related = (category: CategoryId) => categories
    .find((entry) => entry.id === category)!
    .tools.map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is (typeof tools)[number] => Boolean(tool));

  const chooseCategory = (category: CategoryId) => {
    if (category === "ai") onAiSelect();
    const choices = related(category);
    const preferredId = activeCategory === category ? activeTool : recent[category];
    const preferred = choices.find((tool) => tool.id === preferredId) ?? choices[0];
    if (preferred) {
      setRecent((value) => ({ ...value, [category]: preferred.id }));
      onSelect(preferred.id, preferred.workspace);
    }
  };

  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  return (
    <>
      <aside className="spatial-toolbar" aria-label="Primary tools">
        <div className="primary-tool-categories">
          {compactDesktop ? DESKTOP_TOOL_RAIL.map((toolId) => {
            const tool = tools.find((candidate) => candidate.id === toolId);
            if (!tool) return null;
            return (
              <button
                key={tool.id}
                className={activeTool === tool.id ? "active" : ""}
                onClick={() => onSelect(tool.id, tool.workspace)}
                aria-label={tool.label}
                aria-pressed={activeTool === tool.id}
                title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}`}
              >
                <ToolIcon id={tool.id} />
              </button>
            );
          }) : categories.map((category) => (
            <button
              key={category.id}
              className={activeCategory === category.id || (category.id === "ai" && flyout === "ai") ? "active" : ""}
              onClick={() => chooseCategory(category.id)}
              onContextMenu={(event) => { event.preventDefault(); setFlyout(category.id); }}
              onPointerDown={() => { stopHold(); holdTimer.current = setTimeout(() => setFlyout(category.id), 480); }}
              onPointerUp={stopHold}
              onPointerCancel={stopHold}
              onPointerLeave={stopHold}
              aria-label={`${category.label} tools`}
              aria-pressed={activeCategory === category.id}
              aria-haspopup="menu"
              title={`${category.label} · right-click for related tools`}
            >
              <CategoryIcon id={category.id} />
              <span>{category.label}</span>
            </button>
          ))}
          <button
            className="tool-library-trigger"
            onClick={() => { setLibraryOpen(true); setFlyout(null); }}
            aria-label="More tools and command search"
            aria-expanded={libraryOpen}
            title="More Tools (⌘K)"
          >
            <CategoryIcon id="more" />
            <span>More</span>
          </button>
        </div>
      </aside>

      {flyout && (
        <div className="tool-family-scrim" onPointerDown={() => setFlyout(null)}>
          <section className="tool-family-menu" role="menu" aria-label={`${flyout} tools`} onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <CategoryIcon id={flyout} size={18} />
              <div><strong>{categories.find((category) => category.id === flyout)?.label}</strong><span>Related tools</span></div>
            </header>
            <div>
              {related(flyout).map((tool) => (
                <button
                  key={tool.id}
                  className={activeTool === tool.id ? "active" : ""}
                  onClick={() => { setRecent((value) => ({ ...value, [flyout]: tool.id })); onSelect(tool.id, tool.workspace); setFlyout(null); }}
                  role="menuitem"
                >
                  <ToolIcon id={tool.id} size={17} />
                  <span>{tool.label}</span>
                  <kbd>{tool.shortcut}</kbd>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {libraryOpen && (
        <ToolPalette
          groups={groups}
          activeTool={activeTool}
          onSelect={(tool, workspace) => {
            onSelect(tool, workspace);
            setLibraryOpen(false);
          }}
          onCommand={(command) => { onCommand(command); setLibraryOpen(false); }}
          onClose={() => setLibraryOpen(false)}
        />
      )}
    </>
  );
}
