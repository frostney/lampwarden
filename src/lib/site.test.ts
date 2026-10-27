import { expect, test } from "bun:test";

import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

import { serialiseJsonLd, structuredData } from "./json-ld";
import { DEFINITION, DESCRIPTION, LAST_CONTENT_CHANGE, SITE_NAME, SITE_URL, TITLE } from "./site";

test("the title and description fit a search result", () => {
  expect(TITLE.length).toBeLessThanOrEqual(60);
  expect(DESCRIPTION.length).toBeLessThanOrEqual(160);
  expect(TITLE.startsWith(SITE_NAME)).toBe(true);
});

test("the sitemap lists the one page, dated by the constant and never by the build", () => {
  expect(LAST_CONTENT_CHANGE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(sitemap()).toEqual([{ url: SITE_URL, lastModified: LAST_CONTENT_CHANGE }]);
});

test("robots.txt lets every crawler in and names the sitemap", () => {
  expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` });
});

test("the manifest's name is the site's", () => {
  expect(manifest().name).toBe(SITE_NAME);
});

test("the JSON-LD says only what the page says, and survives being put inside a script", () => {
  const text = serialiseJsonLd(structuredData);
  expect(text).not.toContain("<");
  expect(JSON.parse(text)).toEqual(structuredData);
  const game = structuredData["@graph"].find((node) => node["@type"] === "VideoGame");
  expect(game?.description).toBe(DEFINITION);
  expect(game?.url).toBe(SITE_URL);
  for (const key of ["offers", "license", "softwareVersion", "datePublished", "author", "aggregateRating"]) {
    expect(text).not.toContain(`"${key}"`);
  }
});

test("a string with a closing script tag cannot end the script early", () => {
  expect(serialiseJsonLd({ name: "</script><b>" })).toBe('{"name":"\\u003c/script>\\u003cb>"}');
});
