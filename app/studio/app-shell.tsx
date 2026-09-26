"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import "./workspace.css";

type RegionProps = ComponentPropsWithoutRef<"div"> & { children: ReactNode };

/** Layout-only root. It deliberately knows nothing about documents or tools. */
export function AppShell({ children }: { children: ReactNode }) {
  return <main className="spatial-studio" data-app-shell="luma-studio" data-ui="atelier">{children}</main>;
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
