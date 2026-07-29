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
  title: "Luma Studio — Make anything. Stay in flow.",
  description:
    "The depth of a professional image editor, reimagined around speed, clarity and creative intelligence.",
  openGraph: {
    title: "Luma Studio",
    description: "One studio. Every kind of imagination.",
    type: "website",
    url: "https://luma-studio-preview.armonon.chatgpt.site",
    images: [
      {
        url: "https://luma-studio-preview.armonon.chatgpt.site/og.png",
        width: 1200,
        height: 630,
        alt: "Luma Studio unified Edit, Mask, Develop and 3D workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luma Studio",
    description: "One studio. Every kind of imagination.",
    images: ["https://luma-studio-preview.armonon.chatgpt.site/og.png"],
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
