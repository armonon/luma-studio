"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { phoneKeyboardOpen, phoneViewport } from "./phone-workspace";
import { browserFrameCoalescer } from "./frame-coalescer";
import "./workspace.css";
import "./tablet-workspace.css";
import "./phone-workspace.css";

type RegionProps = ComponentPropsWithoutRef<"div"> & { children: ReactNode };

/** Layout-only root. It deliberately knows nothing about documents or tools. */
export function AppShell({ children, tablet = false, phone = false, focus = false }: { children: ReactNode; tablet?: boolean; phone?: boolean; focus?: boolean }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = root.current;
    if (!phone || !viewport || !element) return;
    let previous = "";
    let keyboardOpen = false;
    const update = () => {
      const next = phoneViewport(viewport.height, viewport.offsetTop, viewport.scale);
      if (!next) return;
      const active = document.activeElement;
      const textEntry = active instanceof HTMLElement && active.matches('textarea, [contenteditable="true"], input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])');
      const keyboard = phoneKeyboardOpen(window.innerHeight, viewport.height, viewport.scale, textEntry, keyboardOpen);
      keyboardOpen = keyboard;
      const signature = `${next.height}:${next.top}:${keyboard}`;
      if (signature === previous) return;
      previous = signature;
      element.style.setProperty("--phone-viewport-height", `${next.height}px`);
      element.style.setProperty("--phone-viewport-top", `${next.top}px`);
      element.dataset.softKeyboard = String(keyboard);
    };
    const frame = browserFrameCoalescer(update);
    const resize = () => frame.push(true);
    update();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    document.addEventListener("focusin", resize);
    document.addEventListener("focusout", resize);
    return () => {
      frame.cancel();
      viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize);
      document.removeEventListener("focusin", resize); document.removeEventListener("focusout", resize);
      delete element.dataset.softKeyboard;
      element.style.removeProperty("--phone-viewport-height"); element.style.removeProperty("--phone-viewport-top");
    };
  }, [phone]);
  return <main ref={root} className="spatial-studio" data-app-shell="luma-studio" data-ui="atelier" data-interface={tablet ? "tablet" : "desktop"} data-form-factor={phone ? "phone" : undefined} data-canvas-focus={focus}>{children}</main>;
}

export function AppWindow({ children, ...props }: RegionProps) {
  return <section {...props} className={`spatial-window ${props.className ?? ""}`.trim()}>{children}</section>;
}

export function AppWorkspace({ children, ...props }: RegionProps) {
  return <div {...props} className={`spatial-workspace ${props.className ?? ""}`.trim()}>{children}</div>;
}

export function MenuBarRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ToolRailRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function DocumentAreaRegion({ children, ...props }: RegionProps) {
  return <section {...props} className={`spatial-canvas-column ${props.className ?? ""}`.trim()}>{children}</section>;
}

export function DockRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ContextualTaskBarRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function StatusBarRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
