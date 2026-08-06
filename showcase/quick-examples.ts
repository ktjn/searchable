import { escapeHtml } from "./gallery-shared.js";

export type GalleryMode = "lexical" | "vector" | "hybrid";

export interface QuickExample {
  id: string;
  title: string;
  description: string;
  guideHref: string;
  indexPath: string;
  initialQuery: string;
  facets?: readonly string[];
  fuzzy?: boolean;
  synonyms?: boolean;
  languages?: readonly string[];
  highlight?: boolean;
  operator?: "and" | "or";
  modes?: readonly GalleryMode[];
  boostFields?: Record<string, number>;
  boostTerms?: Record<string, number>;
  fuzzyWeight?: number;
  synonymWeight?: number;
  browse?: boolean;
}

export const QUICK_EXAMPLES: readonly QuickExample[] = [
  {
    id: "basic",
    title: "Basic search",
    description: "Rank real pages from a static index.",
    guideHref: "../docs/getting-started/first-search.html",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "desk",
  },
  {
    id: "fuzzy",
    title: "Fuzzy matching",
    description: "Compare a typo with fuzzy matching disabled and enabled.",
    guideHref:
      "../docs/guides/ranking-and-boosts.html#prefix-and-fuzzy-matching",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "wirelss",
    fuzzy: true,
    fuzzyWeight: 0.5,
  },
  {
    id: "facets",
    title: "Facet filtering",
    description: "Narrow the product corpus with live category counts.",
    guideHref: "../docs/guides/facets.html",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "product",
    facets: ["category"],
  },
  {
    id: "synonyms",
    title: "Synonym expansion",
    description: "Show results that only appear through a synonym rule.",
    guideHref: "../docs/guides/synonyms.html",
    indexPath: "gallery/synonyms/search-index/manifest.json",
    initialQuery: "sofa",
    synonyms: true,
    synonymWeight: 0.5,
  },
  {
    id: "pinning",
    title: "Pinned results",
    description: "Promote a curated best bet above organic results.",
    guideHref: "../docs/guides/pinning.html",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "returns policy",
  },
  {
    id: "internationalization",
    title: "Internationalized search",
    description: "Query one multilingual index through language partitions.",
    guideHref: "../docs/guides/internationalization.html",
    indexPath: "gallery/i18n/search-index/manifest.json",
    initialQuery: "espresso",
    languages: ["en", "de", "sv", "nl", "nb", "nn"],
  },
  {
    id: "highlighting",
    title: "Result highlighting",
    description: "Mark the matched spans in every stored field.",
    guideHref: "../docs/reference/client-api.html#search-options-and-results",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "headphones",
    highlight: true,
  },
  {
    id: "operator",
    title: "AND vs OR matching",
    description: "Require every term, or accept any term, in one query.",
    guideHref: "../docs/guides/ranking-and-boosts.html#query-input-forms",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "headphones keyboard",
    operator: "or",
  },
  {
    id: "phrase",
    title: "Exact phrase",
    description: "Quoted phrases need adjacent terms, in order.",
    guideHref:
      "../docs/guides/ranking-and-boosts.html#phrase-and-proximity-queries",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: '"mechanical keyboard"',
  },
  {
    id: "prefix",
    title: "Prefix search",
    description: "head* matches any analyzed term starting with head.",
    guideHref:
      "../docs/guides/ranking-and-boosts.html#prefix-and-fuzzy-matching",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "head*",
  },
  {
    id: "boosts",
    title: "One-query term boost",
    description: "Re-rank a single search toward a term, no rebuild.",
    guideHref: "../docs/guides/ranking-and-boosts.html#boost-types-summarized",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "wireless speaker",
    operator: "or",
    boostTerms: { speaker: 5 },
  },
  {
    id: "did-you-mean",
    title: "Did you mean?",
    description: "A two-edit typo still surfaces a near term with fuzzy on.",
    guideHref:
      "../docs/guides/ranking-and-boosts.html#did-you-mean-and-query-suggestions",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "wirelssz",
    fuzzy: true,
  },
  {
    id: "vector",
    title: "Vector & hybrid mode",
    description: "Swap lexical, vector, and RRF-hybrid retrieval on one query.",
    guideHref: "../docs/guides/vector-search.html#api-surface",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "desk",
    modes: ["hybrid", "lexical", "vector"],
  },
  {
    id: "browse",
    title: "Browse before you type",
    description: "Filter a facet-only panel with no query text at all.",
    guideHref: "../docs/reference/client-api.html#facet-only-queries",
    indexPath: "gallery/products/search-index/manifest.json",
    initialQuery: "",
    facets: ["category"],
    browse: true,
  },
];

export function renderRuntimeAttributes(example: QuickExample): string {
  const attributes = [
    "data-gallery-root",
    `data-example-id="${escapeHtml(example.id)}"`,
    `data-index-path="${escapeHtml(example.indexPath)}"`,
    `data-default-query="${escapeHtml(example.initialQuery)}"`,
  ];
  if (example.facets?.length) {
    attributes.push(`data-facets="${escapeHtml(example.facets.join(","))}"`);
  }
  if (example.fuzzy) attributes.push('data-fuzzy-toggle="true"');
  if (example.fuzzyWeight !== undefined) {
    attributes.push(`data-fuzzy-weight="${example.fuzzyWeight}"`);
  }
  if (example.synonyms) attributes.push('data-synonyms-toggle="true"');
  if (example.synonymWeight !== undefined) {
    attributes.push(`data-synonym-weight="${example.synonymWeight}"`);
  }
  if (example.languages?.length) {
    attributes.push(
      `data-languages="${escapeHtml(example.languages.join(","))}"`,
    );
  }
  if (example.highlight) attributes.push('data-highlight="true"');
  if (example.operator !== undefined) {
    attributes.push(`data-operator="${example.operator}"`);
  }
  if (example.modes?.length) {
    attributes.push(`data-modes="${escapeHtml(example.modes.join(","))}"`);
  }
  if (example.boostFields && Object.keys(example.boostFields).length > 0) {
    attributes.push(
      `data-boost-fields="${escapeHtml(
        Object.entries(example.boostFields)
          .map(([field, multiplier]) => `${field}=${multiplier}`)
          .join(","),
      )}"`,
    );
  }
  if (example.boostTerms && Object.keys(example.boostTerms).length > 0) {
    attributes.push(
      `data-boost-terms="${escapeHtml(
        Object.entries(example.boostTerms)
          .map(([term, multiplier]) => `${term}=${multiplier}`)
          .join(","),
      )}"`,
    );
  }
  if (example.browse) attributes.push('data-browse="true"');
  return attributes.join("\n");
}

export function renderExampleCode(example: QuickExample): string {
  if (example.browse) {
    return `import { SearchClient } from "@ktjn/searchable-client";

const client = new SearchClient({
  indexUrl: ${JSON.stringify(example.indexPath)},
});

// Filter-only panel: live counts with no free-text query
const facets = await client.facetValues("category");
for (const value of facets.values) {
  console.log(value.value, value.count);
}`;
  }

  const searchOptions: string[] = [];
  if (example.languages?.[0]) {
    searchOptions.push(`language: ${JSON.stringify(example.languages[0])},`);
  }
  if (example.facets?.length) {
    searchOptions.push(`facets: ${JSON.stringify(example.facets)},`);
  }
  if (example.fuzzy) searchOptions.push("fuzzy: true,");
  if (example.fuzzyWeight !== undefined) {
    searchOptions.push(`fuzzyWeight: ${example.fuzzyWeight},`);
  }
  if (example.synonyms) searchOptions.push("synonyms: true,");
  if (example.synonymWeight !== undefined) {
    searchOptions.push(`synonymWeight: ${example.synonymWeight},`);
  }
  if (example.highlight) searchOptions.push("highlight: true,");
  if (example.operator !== undefined) {
    searchOptions.push(`operator: ${JSON.stringify(example.operator)},`);
  }
  if (example.modes?.[0]) {
    searchOptions.push(`mode: ${JSON.stringify(example.modes[0])},`);
  }
  const boostKinds: Array<[label: string, boosts: Record<string, number>]> = [];
  if (example.boostFields && Object.keys(example.boostFields).length > 0) {
    boostKinds.push(["fields", example.boostFields]);
  }
  if (example.boostTerms && Object.keys(example.boostTerms).length > 0) {
    boostKinds.push(["terms", example.boostTerms]);
  }
  if (boostKinds.length > 0) {
    searchOptions.push("boosts: {");
    for (const [kind, boosts] of boostKinds) {
      searchOptions.push(`  ${kind}: {`);
      for (const [key, multiplier] of Object.entries(boosts)) {
        searchOptions.push(`    ${JSON.stringify(key)}: ${multiplier},`);
      }
      searchOptions.push("  },");
    }
    searchOptions.push("},");
  }

  const options = searchOptions.length
    ? `, {\n${searchOptions.map((option) => `  ${option}`).join("\n")}\n}`
    : "";

  return `import { SearchClient } from "@ktjn/searchable-client";

const client = new SearchClient({
  indexUrl: ${JSON.stringify(example.indexPath)},
});

const result = await client.search(${JSON.stringify(example.initialQuery)}${options});`;
}
