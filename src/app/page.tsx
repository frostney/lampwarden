import type { Metadata } from "next";

import { GameClient } from "@/components/GameClient";
import { serialiseJsonLd, structuredData } from "@/lib/json-ld";
import { DESCRIPTION, SITE_NAME, SITE_URL, TITLE } from "@/lib/site";

// The page's own metadata, not the layout's: the layout's reaches every route, the 404 page included, and a page that does
// not exist must not claim the game's description, address or share card text. The share card images come from
// opengraph-image.png and twitter-image.png beside this file.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: SITE_URL },
  openGraph: { type: "website", siteName: SITE_NAME, title: TITLE, description: DESCRIPTION, url: SITE_URL },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function Page() {
  return (
    <main className="shell">
      <script
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the JSON-LD is our own constant, serialised with "<" escaped
        dangerouslySetInnerHTML={{ __html: serialiseJsonLd(structuredData) }}
        type="application/ld+json"
      />
      <GameClient />
    </main>
  );
}
