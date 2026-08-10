import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Luma Studio — Complex canvas. Clear workspace.",
  description:
    "Professional image editing with Layer Focus, multi-pass blending, capture brushes, precision color, branching history and editable AI.",
  openGraph: {
    title: "Luma Studio — Complex canvas. Clear workspace.",
    description: "Layer Focus, multi-pass blending and capture brushes in one precision image studio.",
    type: "website",
    url: "https://luma-studio-preview.armonon.chatgpt.site",
    images: [
      {
        url: "https://luma-studio-preview.armonon.chatgpt.site/og-luma-studio.png",
        width: 1735,
        height: 906,
        alt: "Luma Studio — Complex canvas. Clear workspace.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luma Studio — Complex canvas. Clear workspace.",
    description: "Layer Focus, multi-pass blending and capture brushes in one precision image studio.",
    images: ["https://luma-studio-preview.armonon.chatgpt.site/og-luma-studio.png"],
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
