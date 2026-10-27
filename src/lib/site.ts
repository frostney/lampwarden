// The words the site says about itself, in one place: the page's metadata, the loading fallback, the JSON-LD and the
// sitemap all read them, so none can drift from the others. They are the README's own sentences and package.json's facts.

// The one address the page is indexed under. Next prints the canonical, og:url and the sitemap's <loc> from it, and the
// JSON-LD's url too, so all four stay byte-identical (the built output is the proof, see the PR).
export const SITE_URL = "https://lampwarden.vercel.app";

export const SITE_NAME = "Lampwarden";

export const TITLE = "Lampwarden: night-defence roguelite in a Greek harbour town";

// the <meta name="description">, og:description and twitter:description
export const DESCRIPTION =
  "A night-defence roguelite in a Greek harbour town. Relight the lamps and keep one burning until dawn; when a warden falls, an heir takes up the lamp.";

// What the game is, in the README's words. It is the first thing a crawler that runs no JavaScript reads, and the
// JSON-LD's description.
export const DEFINITION =
  "A night-defence roguelite in Lychnos, a Greek harbour town. Each night the sea sends creatures to put out the town's lamps; you strike them down, relight the lamps and keep one burning until dawn. When a warden falls, an heir takes up the lamp.";

export const PLAY_NOTE = "Plays in the browser with keyboard and mouse, a gamepad or touch.";

export const ORIGIN_NOTE = "Built at Night Shift, Mubit's hackathon in London, 24–25 October 2026.";

// The day the page's visible copy last changed (an ISO date). The sitemap's <lastmod> is this and nothing else, never
// the build time: bump it by hand whenever the text above, or what the page shows, changes.
export const LAST_CONTENT_CHANGE = "2026-10-27";
