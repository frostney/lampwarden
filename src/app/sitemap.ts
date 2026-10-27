import type { MetadataRoute } from "next";

import { LAST_CONTENT_CHANGE, SITE_URL } from "@/lib/site";

// /sitemap.xml: the game is one page. <lastmod> is the day its visible copy last changed (src/lib/site.ts), not the build.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: LAST_CONTENT_CHANGE }];
}
