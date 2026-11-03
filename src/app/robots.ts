import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

// /robots.txt: every crawler may fetch everything, and the sitemap is named so a crawler finds it without being told.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
