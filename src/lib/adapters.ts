// TRUSTED CORE RULES (maintained by LMT maintainers)
// Long-trusted sites live here. For everything else, drop a new adapter file
// into src/lib/adapters/ - it is auto-imported at build time.
// See src/lib/adapters/README.md.
export const COMMUNITY_RULES: SiteRule[] = [
  {
    id: "mangadex",
    domain: "mangadex.org",
    seriesName: {
      regex:
        "^(?:.*?\\|\\s*)?(?:(?:Chapter|Vol)[^\\-]+\\-\\s*)?(.*?)\\s*\\-\\s*MangaDex",
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
  },
  {
    id: "nhentai",
    domain: "nhentai.net",
    seriesName: {
      regex: "^(.*?)\\s*Ch(?:apter)?\\s+[\\d.]+\\s*-\\s*Page",
      source: "title",
    },
    chapterId: {
      regex: "Ch(?:apter)?\\s+([\\d.]+)\\s*-\\s*Page",
      source: "title",
    },
    pageIndex: {
      regex: "\\/g\\/\\d+\\/(\\d+)\\/?$",
      source: "path",
    },
  }
];

// Community adapter files in src/lib/adapters/ are bundled at build time.
// Each file default-exports a SiteRule or SiteRule[]; files prefixed with `_`
// are skipped. Trusted core rules above win on domain conflicts.
const adapterModules = import.meta.glob<{ default: SiteRule | SiteRule[] }>(
  ["./adapters/*.ts", "!./adapters/_*.ts"],
  { eager: true },
);

for (const mod of Object.values(adapterModules)) {
  const rule = mod.default;
  if (Array.isArray(rule)) COMMUNITY_RULES.push(...rule);
  else COMMUNITY_RULES.push(rule);
}

const FALLBACK_RULE: SiteRule = {
  id: "fallback",
  domain: ".*",
  seriesName: {
    regex: "^([^\\-\\|]+)",
    source: "title",
  },
  chapterId: {
    regex: "\\/([^/]+)\\/?$",
    source: "path",
  },
  pageIndex: {
    regex: "\\/(\\d+)\\/?$",
    source: "path",
  },
};

export const MAKE_SITE_RULE_PROMPT = (title: string, path: string) => ({
  system: `You are an expert at writing JavaScript Regular Expressions for a web scraping extension.
Your task is to analyze a provided webpage Title and URL Path, and generate the regex patterns needed to dynamically extract three specific pieces of metadata: the Series Name, the Chapter ID (or number), and the Page Index.

CRITICAL INSTRUCTIONS:
1. GENERALIZATION (MOST IMPORTANT): Do NOT hardcode the literal series name, chapter ID, or page number into the regex. Your regex MUST be based on the structural formatting of the text so it works for ANY manga on the exact same website.
   - BAD (Hardcoded): "Youjo Senki"
   - GOOD (Dynamic): "^(.*?)\\s+-\\s+Chapter"
2. Contextual Extraction: Evaluate the "Title", "Path" and (when present) the URL hash fragment "#...". Decide which source is the most reliable place to extract each piece of data. Use source "hash" (e.g. "#page=4") only when the page number lives in the hash; note that "hash" is matched against location.hash including the leading "#".
3. Capturing Groups: Your regex MUST use exactly one capturing group "( )" per pattern to isolate the target value. Do not capture surrounding text like "Chapter" or "Page" inside the group itself.
4. JSON String Escaping: You MUST double-escape all backslashes because your output will be parsed as a JSON string inside a larger configuration file. 
   - Example: Use "\\\\d+" instead of "\\d+"
   - Example: Use "\\\\/" instead of "\\/"
5. Output Format: You must output strictly valid JSON matching the exact structure below. Do not include markdown formatting, conversational text, or explanations.

EXPECTED JSON STRUCTURE:
{
  "seriesName": {
  "regex": "your double-escaped, dynamic regex here",
  "source": "title" // MUST be exactly "title", "path", or "hash"
},
  "chapterId": {
  "regex": "your double-escaped, dynamic regex here",
  "source": "path" // MUST be exactly "title", "path", or "hash"
},
  "pageIndex": {
  "regex": "your double-escaped, dynamic regex here",
  "source": "path" // MUST be exactly "title", "path", or "hash"
}
}`,
  user: `Here is the current webpage data to analyze:
Title: "${title}"
Path: "${path}"

Generate the regex patterns according to the system instructions.`,
});

export async function getSiteRule(
  rulesOverride?: SiteRule[],
  hostname?: string,
  title?: string,
  path?: string,
) {
  let rules = rulesOverride;
  if (!rules) {
    const customRules =
      (await storage.getItem<SiteRule[]>("sync:custom-site-rules")) ?? [];
    rules = [...customRules, ...COMMUNITY_RULES];
  }

  hostname = hostname || window.location.hostname;
  const availableSources: Record<ExtractSource, string> = {
    title: title || document.title,
    path: path || window.location.pathname,
    hash: path === undefined ? window.location.hash : "",
  };

  let activeRule =
    rules.find((r) => r.domain && hostname.includes(r.domain)) || FALLBACK_RULE;

  const safeExtract = (
    sourceType: ExtractSource,
    regexStr: string,
    fallback: string,
  ) => {
    try {
      if (!regexStr) return fallback;
      const match = availableSources[sourceType].match(new RegExp(regexStr));
      return match ? (match[1] || match[0]).trim() : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    ruleId: activeRule.id,
    seriesName: safeExtract(
      activeRule.seriesName.source,
      activeRule.seriesName.regex,
      availableSources.title.split(/[-|]/)[0].trim() || "Unknown Series",
    ),
    chapterId: safeExtract(
      activeRule.chapterId.source,
      activeRule.chapterId.regex,
      availableSources.path.replace(/\//g, "-").slice(1) || "unknown",
    ),
    pageIndex:
      Number(
        safeExtract(
          activeRule.pageIndex.source,
          activeRule.pageIndex.regex,
          "0",
        ),
      ) || 0,
  };
}
