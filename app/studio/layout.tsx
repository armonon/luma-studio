import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Luma Image Editor | thecreatingco",
  description: "Edit images with layers, selections, masks and type in the Luma browser studio.",
  alternates: { canonical: "https://thecreatingco.com/products/luma/" },
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    title: "Luma Image Editor | thecreatingco",
    description: "Edit images with layers, selections, masks and type in the Luma browser studio.",
    url: "https://thecreatingco.com/products/luma/",
    images: [{ url: "https://thecreatingco.com/assets/verified-starters/luma.jpg", alt: "Luma browser image editor" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luma Image Editor | thecreatingco",
    description: "Edit images with layers, selections, masks and type in the Luma browser studio.",
    images: ["https://thecreatingco.com/assets/verified-starters/luma.jpg"],
  },
  manifest: "/luma.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/icons/luma-192.png" },
  appleWebApp: { capable: true, title: "Luma", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#141619" };
export default function StudioLayout({ children }: { children: ReactNode }) { return children; }
