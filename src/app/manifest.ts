import type { MetadataRoute } from "next";

// The web app manifest (served at /manifest.webmanifest). The colours are the page's own (body in globals.css, themeColor
// in layout.tsx); the icons are the committed ones (src/app/icon.png, apple-icon.png, made by `bun run logo`).
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
      { src: "/icon.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
