import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lampwarden",
  description: "Keep the lamps of Lychnos burning until dawn. Sprites generated, verified and corrected through Mubit.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
