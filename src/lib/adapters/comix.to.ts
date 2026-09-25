// Comix - https://comix.to
// Reader URL:
//   https://comix.to/title/5v53l-mairimashita-iruma-kun/11304814-chapter-457
// Title: "Mairimashita! Iruma-kun · Ch.457"
//
// Long-strip reader: all pages share one URL and title, so pageIndex
// intentionally never matches and stays 0 - the page cache and
// series-context key degrade to chapter level on this site.

export default {
  id: "comix",
  domain: "comix.to",
  seriesName: {
    regex: "^(.*?)\\s*·\\s*Ch\\.",
    source: "title",
  },
  chapterId: {
    regex: "-chapter-([\\d.]+)",
    source: "path",
  },
  pageIndex: {
    regex: "^$",
    source: "path",
  },
  containerSelector: ".reader-container, #reader",
  imageSelector: ".reader-container img, .chapter-images img",
} satisfies SiteRule;
