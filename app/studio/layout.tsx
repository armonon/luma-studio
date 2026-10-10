import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Luma",
  manifest: "/luma.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/icons/luma-192.png" },
  appleWebApp: { capable: true, title: "Luma", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#141619" };
export default function StudioLayout({ children }: { children: ReactNode }) { return children; }
