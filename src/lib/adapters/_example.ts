// Site adapter template. Copy this file, rename it to your site's domain
// (e.g. `mangadex.ts`), fill in the patterns, and delete this header.
//
// Rules:
// - File must `export default` a SiteRule (or SiteRule[] for multi-domain
//   site families).
// - Files starting with `_` are ignored by the build.
// - The regex must work for ANY manga on the site, not just one series.
// - Exactly one capturing group per pattern.
// - `source` is "title" (document.title), "path" (URL pathname), or "hash"
//   (URL hash fragment including "#", e.g. "#page=4").
// - Trusted core rules in src/lib/adapters.ts win on domain conflicts.
//
// Tip: use the AI rule generator in extension Settings to draft the regex,
// then paste it here.
import type {} from "wxt/browser";

export default {
  id: "example",
  domain: "example-manga-site.com",
  seriesName: {
    regex: "^(.*?)\\s*-\\s*Chapter",
    source: "title",
  },
  chapterId: {
    regex: "\\/chapter\\/([^/]+)",
    source: "path",
  },
  pageIndex: {
    regex: "\\/(\\d+)\\/?$",
    source: "path",
  },
  // Optional DOM selectors for auto-translation engine:
  containerSelector: ".reader-container",
  imageSelector: ".reader-container img",
} satisfies SiteRule;
