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

export const metadata: Metadata = {
  metadataBase: new URL("https://lampwarden.vercel.app"),
  title: "Lampwarden",
  description: "Keep the lamps of Lychnos burning until dawn. Sprites generated, verified and corrected through Mubit.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b1424",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${titleFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
