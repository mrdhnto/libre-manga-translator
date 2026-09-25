// MangaFire - https://mangafire.to
// Reader URL:
//   https://mangafire.to/title/2ow3l-the-paradise-district/chapter/9409969
// Title: "The Paradise District - Chapter 38"
//
// The URL carries only an internal chapter ID (9409969), not the display
// number, so chapterId is read from the title. Reader is configurable but
// next/prev never touch URL or title, so pageIndex intentionally never
// matches and stays 0 - cache/context key degrades to chapter level.

export default {
  id: "mangafire",
  domain: "mangafire.to",
  seriesName: {
    regex: "^(.*?)\\s*-\\s*Chapter\\s+[\\d.]+",
    source: "title",
  },
  chapterId: {
    regex: "Chapter\\s+([\\d.]+)",
    source: "title",
  },
  pageIndex: {
    regex: "^$",
    source: "path",
  },
  containerSelector: "#wrapper",
  imageSelector: ".reader-container img, .carousel-item img",
} satisfies SiteRule;
