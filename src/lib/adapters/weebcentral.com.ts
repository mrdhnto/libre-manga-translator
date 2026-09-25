// WeebCentral - https://weebcentral.com
// Reader URL: https://weebcentral.com/chapters/01M1FPHAP6TEY7CMV49MGX39P1
// Title: "Chapter 177 | The Exiled Heavy Knight Knows How to Game System | Weeb Central"
//
// All pages of a chapter share one URL and title: there is no page signal to
// extract. pageIndex intentionally never matches and stays 0 - the page cache
// and series-context key degrade to chapter level on this site.

export default {
  id: "weebcentral",
  domain: "weebcentral.com",
  seriesName: {
    regex: "^[^\\|]+\\|\\s*(.+?)\\s*\\|\\s*Weeb Central",
    source: "title",
  },
  chapterId: {
    regex: "^Chapter\\s+([\\d.]+)",
    source: "title",
  },
  pageIndex: {
    regex: "^$",
    source: "path",
  },
  containerSelector: "article",
  imageSelector: "article img",
} satisfies SiteRule;
