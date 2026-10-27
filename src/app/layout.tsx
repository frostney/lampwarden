import type { Metadata, Viewport } from "next";
import { Tiny5 } from "next/font/google";
import localFont from "next/font/local";

import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Ithaca (GGBotNet, OFL 1.1, src/app/fonts/ithaca/License.txt) for titles; Tiny5 (OFL 1.1) for everything else.
// Both are pixel fonts: Ithaca is drawn on a 16 px grid, Tiny5 on 8 px, so sizes stay at integer multiples.
const titleFont = localFont({ src: "./fonts/ithaca/Ithaca.ttf", variable: "--font-title", display: "block" });
const bodyFont = Tiny5({
  weight: "400",
  subsets: ["latin", "latin-ext", "greek"],
  variable: "--font-ui",
  display: "block",
});

// Only what every route shares. The title, description, canonical and share card text are the page's own (page.tsx), so the
// 404 page does not inherit the game's. The images are the file conventions in this folder (opengraph-image.png and
// twitter-image.png), which reach every route.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
};

// pinch-zoom stays on: the menus are DOM text, and WCAG 1.4.4 needs it. The stage turns it off while a night is played
// (touch-action in globals.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1424",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className={`${titleFont.variable} ${bodyFont.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
