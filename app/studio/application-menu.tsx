"use client";

import { useEffect, useRef, useState } from "react";
import { DESKTOP_MENU, type StudioCommand } from "../desktop/menu-model";

const clipboardShortcuts: Partial<Record<StudioCommand, string>> = {
  "copy-pixels": "CmdOrCtrl+C", "cut-pixels": "CmdOrCtrl+X", "paste-pixels": "CmdOrCtrl+V",
};

function shortcutLabel(shortcut: string, mac: boolean) {
  if (!mac) return shortcut.replace("CmdOrCtrl", "Ctrl").replace("Plus", "+");
  return shortcut.replace("CmdOrCtrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥").replace("Plus", "+");
}

const sections = DESKTOP_MENU.filter(section => section.label !== "Luma Studio");

/** The browser menu dispatches the same commands as the native application. */
export default function ApplicationMenu({ onCommand, commandEnabled, onImport }: {
  onCommand: (command: StudioCommand) => void;
  commandEnabled: (command: StudioCommand) => boolean;
  onImport: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [mac, setMac] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform));
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  const focusItem = (index: number, last = false) => {
    setOpen(index);
    requestAnimationFrame(() => {
      const items = root.current?.querySelectorAll<HTMLButtonElement>(`[data-section="${index}"] [role="menu"] [role="menuitem"]:not(:disabled)`);
      items?.[last ? items.length - 1 : 0]?.focus();
    });
  };
  const run = (action: () => void) => {
    setOpen(null);
    root.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${open}"]`)?.focus();
    action();
  };

  return <nav ref={root} className="studio-menu-row" aria-label="Application menus" onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(null);
  }}>
    <div role="menubar" aria-label="Luma commands" onKeyDown={event => {
      event.stopPropagation();
      const active = document.activeElement as HTMLElement | null;
      const section = Number(active?.closest<HTMLElement>("[data-section]")?.dataset.section ?? 0);
      if (event.key === "Escape") {
        event.preventDefault(); setOpen(null);
        root.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${section}"]`)?.focus();
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const next = (section + (event.key === "ArrowRight" ? 1 : -1) + sections.length) % sections.length;
        if (open !== null) focusItem(next);
        else root.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${next}"]`)?.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (active?.hasAttribute("data-menu-trigger")) focusItem(section, event.key === "ArrowUp");
        else {
          const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(`[data-section="${section}"] [role="menu"] [role="menuitem"]:not(:disabled)`) ?? []);
          const current = items.indexOf(active as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      } else if (event.key === "Tab") setOpen(null);
    }}>
      {sections.map((section, index) => <div key={section.label} data-section={index} className="studio-menu-section">
        <button role="menuitem" data-menu-trigger={index} aria-haspopup="menu" aria-expanded={open === index}
          onClick={() => setOpen(open === index ? null : index)}
          onPointerEnter={() => { if (open !== null) setOpen(index); }}>{section.label}</button>
        {open === index && <div role="menu" aria-label={section.label} data-shortcut-menu={section.label === "File" || section.label === "Edit" ? "true" : undefined}>
          {section.label === "File" && <><button role="menuitem" disabled={!commandEnabled("open")} onClick={() => run(onImport)}>Import images…</button><hr role="separator" /></>}
          {section.items.map((item, itemIndex) => item.kind === "command"
            ? <button key={item.id} role="menuitem" aria-label={item.label} disabled={!commandEnabled(item.id)} onClick={() => run(() => onCommand(item.id))}><span>{item.label}</span>{(section.label === "File" || section.label === "Edit") && (item.accelerator || clipboardShortcuts[item.id]) && <kbd aria-hidden="true">{shortcutLabel(item.accelerator || clipboardShortcuts[item.id]!, mac)}</kbd>}</button>
            : item.kind === "separator" ? <hr key={itemIndex} role="separator" /> : null)}
        </div>}
      </div>)}
    </div>
    <button className="studio-import-button" disabled={!commandEnabled("open")} onClick={onImport}>Import images…</button>
    <span className="studio-import-hint">or drop images onto the canvas</span>
  </nav>;
}
