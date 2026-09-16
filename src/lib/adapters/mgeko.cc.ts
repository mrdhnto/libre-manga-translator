// MangaGeko - https://www.mgeko.cc
// Reader URL:
//   https://www.mgeko.cc/reader/en/tanbo-de-hirotta-onna-kishi-inaka-de-
//   ore-no-yome-da-to-omowareteiru-chapter-77-eng-li/
// Title: "Manga: I Found a Female Knight in a Rice Field, in the Countryside
//   They Think She's My Wife Chapter - 77-eng-li"
//
// Long-strip reader: all pages share one URL and title, so pageIndex
// intentionally never matches and stays 0 - the page cache and
// series-context key degrade to chapter level on this site.
// The URL slug is romaji; the English display name only exists in the title.

export default {
  id: "mgeko",
  domain: "mgeko.cc",
  seriesName: {
    regex: "^(?:Manga:\\s*)?(.*?)\\s*Chapter\\s*-",
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
} satisfies SiteRule;
