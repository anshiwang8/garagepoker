import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ERROR_BANNER_SCRIPT } from "@/lib/errorBanner";
import { PREFS_SCRIPT } from "@/lib/prefsScript";
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
  title: "GaragePoker",
  description: "Home-game poker tables. Every game your group plays, no paywall.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The on-screen keyboard shrinks the page instead of covering the bet box.
  interactiveWidget: "resizes-content",
  themeColor: "#0b1210",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // PREFS_SCRIPT sets data-* preferences on <html> before React hydrates; that's expected.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* First, before any bundle: shows errors on screen even if the app can't start. */}
        <script dangerouslySetInnerHTML={{ __html: ERROR_BANNER_SCRIPT }} />
        {/* The chosen felt, card back and deck colours, before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
