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
  title: "Luma Studio — Creative imaging, beautifully reimagined",
  description:
    "A fast, focused and beautifully designed professional image editor.",
  openGraph: {
    title: "Luma Studio",
    description: "Creative imaging, reimagined.",
    type: "website",
    url: "https://luma-studio-preview.armonon.chatgpt.site",
    images: [
      {
        url: "https://luma-studio-preview.armonon.chatgpt.site/og.jpg",
        width: 1200,
        height: 630,
        alt: "Luma Studio professional image editor",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luma Studio",
    description: "Creative imaging, reimagined.",
    images: ["https://luma-studio-preview.armonon.chatgpt.site/og.jpg"],
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
