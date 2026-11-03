import { DEFINITION, SITE_NAME, SITE_URL } from "./site";

const SITE_ID = `${SITE_URL}/#website`;

// Only what the page says: the name, the README's definition, "roguelite" and "browser" from the visible text, and the
// repository. No price, licence, version, date, author or rating: none is stated anywhere on the page.
export const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": SITE_ID, name: SITE_NAME, url: SITE_URL, inLanguage: "en" },
    {
      "@type": "VideoGame",
      "@id": `${SITE_URL}/#game`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DEFINITION,
      genre: "Roguelite",
      gamePlatform: "Web browser",
      applicationCategory: "Game",
      inLanguage: "en",
      image: `${SITE_URL}/opengraph-image.png`,
      isPartOf: { "@id": SITE_ID },
      sameAs: ["https://github.com/frostney/lampwarden"],
    },
  ],
};

// JSON inside a <script> ends at the first "</script", so every "<" is written as \u003c (the same JSON value)
export function serialiseJsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
