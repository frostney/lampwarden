import type { Metadata, Viewport } from "next";
import { Tiny5 } from "next/font/google";
import localFont from "next/font/local";
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

const DESCRIPTION =
  "Keep the lamps of Lychnos burning until dawn. Sprites generated, verified and corrected through Mubit.";

export const metadata: Metadata = {
  metadataBase: new URL("https://lampwarden.vercel.app"),
  title: "Lampwarden",
  description: DESCRIPTION,
  // the share card images come from opengraph-image.png and twitter-image.png beside this file
  openGraph: { type: "website", siteName: "Lampwarden", title: "Lampwarden", description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: "Lampwarden", description: DESCRIPTION },
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
