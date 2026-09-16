# Site Adapters

Drop-in adapters auto-imported at build time. No registry edits needed.

## Add a site

1. Copy `_example.ts` to `<site-domain>.ts` (e.g. `mangadex.ts`).
2. Fill in `seriesName`, `chapterId`, `pageIndex` - each with one capturing
   group, matching any manga on the site, not just one series. `source` is
   `title` (document.title), `path` (URL pathname), or `hash` (URL hash
   fragment including `#`, e.g. `#page=4`).
3. PR it. The next build bundles it automatically.

## Rules

- File must `export default` a `SiteRule`, or `SiteRule[]` for multi-domain
  site families.
- Files starting with `_` are skipped by the build.
- The trusted core in `src/lib/adapters.ts` wins on domain conflicts - only
  add an adapter there if the site is long-trusted and stable.

## Draft the regex without writing it

Open any chapter on the target site, click the LMT icon, and use the
**AI rule generator** in Settings (WebGPU, Gemini, or API). Paste the result
into your file and verify against a second series on the same site.
