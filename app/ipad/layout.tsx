import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Luma for iPad",
  manifest: "/luma-ipad.webmanifest",
  appleWebApp: { capable: true, title: "Luma", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#141619" };
export default function IPadLayout({ children }: { children: ReactNode }) { return children; }
