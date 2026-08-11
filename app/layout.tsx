import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DEPLOY_ORIGIN } from "./deploy-origin";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = DEPLOY_ORIGIN;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Luma Studio — Complex canvas. Clear workspace.",
  description:
    "Professional image editing with Layer Focus, multi-pass blending, capture brushes, precision color, branching history and editable AI.",
  openGraph: {
    title: "Luma Studio — Complex canvas. Clear workspace.",
    description: "Layer Focus, multi-pass blending and capture brushes in one precision image studio.",
    type: "website",
    url: "/",
    images: [
      {
        url: "/og-luma-studio.jpg",
        width: 1200,
        height: 630,
        alt: "Luma Studio — Complex canvas. Clear workspace.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luma Studio — Complex canvas. Clear workspace.",
    description: "Layer Focus, multi-pass blending and capture brushes in one precision image studio.",
    images: ["/og-luma-studio.jpg"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
