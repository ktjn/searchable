export interface DocPage {
  source: string;
  route: string;
  title: string;
}

export interface DocSection {
  title: string;
  pages: readonly DocPage[];
}

export const DOC_SECTIONS: readonly DocSection[] = [
  {
    title: "Getting started",
    pages: [
      {
        source: "docs/getting-started/overview.md",
        route: "docs/getting-started/overview",
        title: "Overview",
      },
      {
        source: "docs/getting-started/installation.md",
        route: "docs/getting-started/installation",
        title: "Installation",
      },
      {
        source: "docs/getting-started/first-search.md",
        route: "docs/getting-started/first-search",
        title: "Your first search",
      },
    ],
  },
  {
    title: "Guides",
    pages: (
      [
        ["indexing", "Indexing content"],
        ["ranking-and-boosts", "Ranking and boosts"],
        ["facets", "Faceted search"],
        ["synonyms", "Synonyms"],
        ["pinning", "Pinned results"],
        ["internationalization", "Internationalization"],
      ] as const
    ).map(([name, title]) => ({
      source: `docs/guides/${name}.md`,
      route: `docs/guides/${name}`,
      title,
    })),
  },
  {
    title: "Concepts",
    pages: (
      [
        ["architecture", "Architecture"],
        ["index-format", "Index format"],
      ] as const
    ).map(([name, title]) => ({
      source: `docs/concepts/${name}.md`,
      route: `docs/concepts/${name}`,
      title,
    })),
  },
  {
    title: "Reference",
    pages: (
      [
        ["client-api", "Client API"],
        ["configuration", "Configuration"],
        ["cms-meta-tags", "CMS meta tags"],
        ["compatibility", "Compatibility"],
      ] as const
    ).map(([name, title]) => ({
      source: `docs/reference/${name}.md`,
      route: `docs/reference/${name}`,
      title,
    })),
  },
  {
    title: "Project",
    pages: [
      ...(
        [
          ["roadmap", "Roadmap"],
          ["relevance-baselines", "Relevance baselines"],
          ["performance-baseline", "Performance baseline"],
          ["governance", "Governance"],
          ["architecture-decisions", "Architecture decisions"],
        ] as const
      ).map(([name, title]) => ({
        source: `docs/project/${name}.md`,
        route: `docs/project/${name}`,
        title,
      })),
      ...(
        [
          ["0001-pull-based-static-http", "ADR-0001: Pull-based static HTTP"],
          ["0002-json-first-index-format", "ADR-0002: JSON-first index format"],
          ["0003-bm25f-ranking-model", "ADR-0003: BM25F ranking model"],
          ["0004-compatibility-policy", "ADR-0004: Compatibility policy"],
          ["0005-plugin-opt-in-boundary", "ADR-0005: Plugin opt-in boundary"],
        ] as const
      ).map(([name, title]) => ({
        source: `docs/adr/${name}.md`,
        route: `docs/adr/${name}`,
        title,
      })),
    ],
  },
];
