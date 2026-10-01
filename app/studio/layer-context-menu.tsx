"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { StudioCommand } from "../desktop/menu-model";
import { COMMAND_DEFINITIONS } from "./command-registry";

export const LAYER_CONTEXT_COMMANDS: StudioCommand[] = ["group-layer", "ungroup-layers", "merge-layers", "duplicate-layer", "rename-layer", "toggle-layer-visibility", "toggle-layer-lock", "copy-layer-style", "paste-layer-style", "delete-layer"];

export default function LayerContextMenu({ x, y, count, enabled, execute, close, mergeReason, touch = false }: {
  touch?: boolean;
  x: number; y: number; count: number; enabled: (id: StudioCommand) => boolean;
  execute: (id: StudioCommand) => void; close: () => void; mergeReason?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close(); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close);
      if (menu.contains(document.activeElement) && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [x, y, close]);
  return createPortal(<div ref={ref} className="layer-context-menu" data-touch={touch} role="menu" aria-label="Layer context actions" style={{ left: x, top: y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }
  }}>
    <div className="layer-context-heading">{count} {count === 1 ? "layer" : "layers"} selected</div>
    {touch && <button role="menuitem" onClick={close}>Close actions</button>}
    {LAYER_CONTEXT_COMMANDS.map(id => <button key={id} type="button" role="menuitem" disabled={!enabled(id)} className={id === "delete-layer" ? "danger" : ""} title={id === "merge-layers" ? mergeReason ?? "Rasterize selected layers into one. Undo restores the originals." : undefined} onClick={() => { close(); execute(id); }}>
      <span>{id === "duplicate-layer" ? "Duplicate selected layers" : id === "delete-layer" ? "Delete selected layers" : COMMAND_DEFINITIONS[id].label}</span>
      <kbd>{COMMAND_DEFINITIONS[id].shortcut.replace("CmdOrCtrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥")}</kbd>
    </button>)}
  </div>, document.body);
}
