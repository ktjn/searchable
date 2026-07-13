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
    languages: ["en", "de"],
  },
];

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderRuntimeAttributes(example: QuickExample): string {
  const attributes = [
    "data-gallery-root",
    `data-example-id="${escapeAttribute(example.id)}"`,
    `data-index-path="${escapeAttribute(example.indexPath)}"`,
    `data-default-query="${escapeAttribute(example.initialQuery)}"`,
  ];
  if (example.facets?.length) {
    attributes.push(
      `data-facets="${escapeAttribute(example.facets.join(","))}"`,
    );
  }
  if (example.fuzzy) attributes.push('data-fuzzy-toggle="true"');
  if (example.synonyms) attributes.push('data-synonyms-toggle="true"');
  if (example.languages?.length) {
    attributes.push(
      `data-languages="${escapeAttribute(example.languages.join(","))}"`,
    );
  }
  return attributes.join("\n");
}

export function renderExampleCode(example: QuickExample): string {
  const searchOptions = [
    ...(example.languages?.[0]
      ? [`language: ${JSON.stringify(example.languages[0])}`]
      : []),
    ...(example.facets?.length
      ? [`facets: ${JSON.stringify(example.facets)}`]
      : []),
    ...(example.fuzzy ? ["fuzzy: true"] : []),
    ...(example.synonyms ? ["synonyms: true"] : []),
  ];
  const options = searchOptions.length
    ? `, {\n${searchOptions.map((option) => `  ${option},`).join("\n")}\n}`
    : "";

  return `import { SearchClient } from "@ktjn/searchable-client";

const client = new SearchClient({
  indexUrl: ${JSON.stringify(example.indexPath)},
});

const result = await client.search(${JSON.stringify(example.initialQuery)}${options});`;
}
