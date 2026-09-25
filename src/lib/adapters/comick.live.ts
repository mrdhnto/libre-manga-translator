// ComicK - https://comick.live
// Reader URL:
//   https://comick.live/comic/<series-slug>/<chapter-slug>#page=4
//   e.g. /comic/the-white-mage-who-was-banished.../R647Z1l-chapter-42-en#page=4
// Title: "Chapter 42 - White Mage ... - English | ComicK"
//
// pageIndex lives in the URL hash (#page=N, 1-based, only in 1-page mode).
// Absent hash = page 1 -> falls back to 0, matching MangaDex semantics.

export default {
  id: "comick",
  domain: "comick.live",
  seriesName: {
    regex: "\\/comic\\/([^/]+)",
    source: "path",
  },
  chapterId: {
    regex: "-chapter-([\\d.]+)",
    source: "path",
  },
  pageIndex: {
    regex: "page=(\\d+)",
    source: "hash",
  },
  containerSelector: "main",
  imageSelector: "img[src*='comick'], img.chapter-img",
} satisfies SiteRule;
