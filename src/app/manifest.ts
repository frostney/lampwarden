import type { MetadataRoute } from "next";

// The web app manifest (served at /manifest.webmanifest). The colours are the page's own (body in globals.css, themeColor
// in layout.tsx). The icons are made by `bun run logo` (tools/logo) into public/logo/: "any" fills the square, "maskable"
// keeps the lamp inside the launcher mask's safe zone. Chromium offers to install the app only with 192 and 512 px icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lampwarden",
    short_name: "Lampwarden",
    description: "Keep the lamps of Lychnos burning until dawn.",
    start_url: "/",
    id: "/",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#0b1424",
    theme_color: "#0b1424",
    icons: [
      { src: "/logo/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/logo/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
