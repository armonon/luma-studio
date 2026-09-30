"use client";

import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { phoneViewport } from "./phone-workspace";
import "./workspace.css";
import "./tablet-workspace.css";
import "./phone-workspace.css";

type RegionProps = ComponentPropsWithoutRef<"div"> & { children: ReactNode };

/** Layout-only root. It deliberately knows nothing about documents or tools. */
export function AppShell({ children, tablet = false, phone = false }: { children: ReactNode; tablet?: boolean; phone?: boolean }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = root.current;
    if (!phone || !viewport || !element) return;
    const resize = () => {
      const next = phoneViewport(viewport.height, viewport.offsetTop, viewport.scale);
      if (!next) return;
      element.style.setProperty("--phone-viewport-height", `${next.height}px`);
      element.style.setProperty("--phone-viewport-top", `${next.top}px`);
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize); viewport.removeEventListener("scroll", resize);
      element.style.removeProperty("--phone-viewport-height"); element.style.removeProperty("--phone-viewport-top");
    };
  }, [phone]);
  return <main ref={root} className="spatial-studio" data-app-shell="luma-studio" data-ui="atelier" data-interface={tablet ? "tablet" : "desktop"} data-form-factor={phone ? "phone" : undefined}>{children}</main>;
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
