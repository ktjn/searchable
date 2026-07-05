import { MARKETING_PAGES, TOPICS } from "./content.js";

/**
 * Structurally identical to @csf/indexer's SourceDocument -- not
 * imported from there on purpose, so this package has zero dependency
 * on the packages it exists to test (indexer, client), and can be a
 * devDependency of both without any risk of a cycle.
 */
export interface FixtureDocument {
  id: number;
  url: string;
  html: string;
}

export type FixtureLanguage = "en" | "de";

export interface GenerateCms2kCorpusOptions {
  /**
   * Total generated (non-marketing-page) documents across every
   * requested language, roughly evenly split between them. Named after
   * docs/14-reference-deployment-cms-2k.md's target deployment size,
   * but any size is valid -- pass a smaller count for fast correctness
   * tests, or up to the full ~2000 (or beyond, for Phase 7 macro-
   * benchmarks) to approximate a real CMS export's scale.
   */
  count?: number;
  /**
   * English and German only -- the two LanguageProfiles that actually
   * exist (docs/09-roadmap.md#status, Phase 4). Requesting "ja" or "ar"
   * here would build pages `getLanguageProfile()` has no profile for
   * and buildIndex() would throw; add them once Phase 4 lands those
   * profiles, not before.
   */
  languages?: FixtureLanguage[];
}

const TITLE_ADJECTIVES: Record<string, { en: string[]; de: string[] }> = {
  Engineering: {
    en: [
      "Notes on",
      "A Deep Dive Into",
      "Rethinking",
      "Lessons From",
      "How We Approach",
      "The Case For",
      "Debugging",
      "Scaling",
    ],
    de: [
      "Notizen zu",
      "Ein tiefer Einblick in",
      "Neu gedacht:",
      "Lehren aus",
      "Unser Ansatz für",
      "Warum wir auf",
      "Fehlersuche bei",
      "Skalierung von",
    ],
  },
  Product: {
    en: [
      "Introducing",
      "How",
      "Under the Hood:",
      "Announcing",
      "A Closer Look at",
      "Why We Built",
      "Using",
      "The Design of",
    ],
    de: [
      "Vorstellung:",
      "Wie",
      "Ein Blick unter die Haube:",
      "Ankündigung:",
      "Genauer betrachtet:",
      "Warum wir",
      "Verwendung von",
      "Das Design von",
    ],
  },
  Company: {
    en: [
      "On",
      "Why We Value",
      "How We Think About",
      "Building a Culture of",
      "Reflections on",
      "The Case For",
      "What We Learned About",
      "Our Approach to",
    ],
    de: [
      "Über",
      "Warum wir",
      "Wie wir über",
      "Eine Kultur des",
      "Gedanken zu",
      "Das Argument für",
      "Was wir gelernt haben über",
      "Unser Ansatz für",
    ],
  },
  Guides: {
    en: [
      "Getting Started With",
      "A Guide to",
      "How to Configure",
      "Setting Up",
      "Troubleshooting",
      "Best Practices for",
      "A Walkthrough of",
      "Understanding",
    ],
    de: [
      "Erste Schritte mit",
      "Ein Leitfaden zu",
      "Konfiguration von",
      "Einrichtung von",
      "Fehlerbehebung bei",
      "Bewährte Praktiken für",
      "Ein Rundgang durch",
      "Verstehen von",
    ],
  },
};

const TITLE_NOUNS: Record<string, { en: string[]; de: string[] }> = {
  Engineering: {
    en: [
      "Search Architecture",
      "Index Sharding",
      "Regression Testing",
      "Field Boosts",
      "the Tokenization Pipeline",
      "Web Worker Execution",
      "Shard Caching",
      "Benchmark Methodology",
    ],
    de: [
      "die Sucharchitektur",
      "Index-Sharding",
      "Regressionstests",
      "Feldgewichtungen",
      "die Tokenisierungs-Pipeline",
      "die Web-Worker-Ausführung",
      "Shard-Caching",
      "die Benchmark-Methodik",
    ],
  },
  Product: {
    en: [
      "Faceted Filtering",
      "Field Boosts",
      "Term Pinning",
      "Document Boosts",
      "Typo Tolerance",
      "Did You Mean",
      "Synonym Expansion",
      "Opt-in Search Features",
    ],
    de: [
      "die facettierte Filterung",
      "Feldgewichtungen",
      "Begriffsverknüpfungen",
      "Dokumentengewichtungen",
      "die Tippfehlertoleranz",
      "Meinten-Sie-Vorschläge",
      "die Synonymerweiterung",
      "optionale Suchfunktionen",
    ],
  },
  Company: {
    en: [
      "Remote Work",
      "Slow Hiring",
      "Shipping in Week One",
      "Public Postmortems",
      "Meeting Culture",
      "Judgment Over Credentials",
      "Career Growth",
      "Staying Small",
    ],
    de: [
      "Remote-Arbeit",
      "langsame Einstellungen",
      "das Ausliefern in der ersten Woche",
      "öffentliche Nachbesprechungen",
      "Besprechungskultur",
      "Urteilsvermögen statt Abschlüsse",
      "Karrierewachstum",
      "das Kleinbleiben",
    ],
  },
  Guides: {
    en: [
      "Content Extraction",
      "Meta Tag Configuration",
      "Your Build Pipeline",
      "Static Shard Hosting",
      "Local Testing",
      "Progressive Feature Adoption",
      "Token Mismatches",
      "Your First Index",
    ],
    de: [
      "die Inhaltsextraktion",
      "die Meta-Tag-Konfiguration",
      "Ihre Build-Pipeline",
      "statisches Shard-Hosting",
      "lokales Testen",
      "die schrittweise Funktionsnutzung",
      "Token-Abweichungen",
      "Ihren ersten Index",
    ],
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function renderPage(opts: {
  language: FixtureLanguage;
  title: string;
  excerpt: string;
  paragraphs: string[];
  category?: string;
  tags?: string[];
  featured?: boolean;
  pin?: string;
}): string {
  const meta = [
    `<meta name="description" content="${escapeHtml(opts.excerpt)}">`,
    ...(opts.category
      ? [
          `<meta name="csf-facet-category" content="${escapeHtml(opts.category)}">`,
        ]
      : []),
    ...(opts.tags ?? []).map(
      (t) => `<meta name="csf-facet-tags" content="${escapeHtml(t)}">`,
    ),
    ...(opts.featured ? [`<meta name="csf-boost" content="1.8">`] : []),
    ...(opts.pin
      ? [`<meta name="csf-pin" content="${escapeHtml(opts.pin)}">`]
      : []),
  ].join("\n    ");
  const body = opts.paragraphs
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n      ");
  return `<!doctype html>
<html lang="${opts.language}">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(opts.title)}</title>
    ${meta}
  </head>
  <body>
    <main>
      <h1>${escapeHtml(opts.title)}</h1>
      ${body}
    </main>
  </body>
</html>
`;
}

function firstSentence(text: string): string {
  const match = /^[^.]*\./.exec(text);
  return (match ? match[0] : text).trim();
}

/**
 * Deterministic (not random) so the corpus, and any regression snapshot
 * taken against it, is stable across builds and across machines -- the
 * same reasoning as showcase/gallery-data.ts's product generator.
 */
export function generateCms2kCorpus(
  options: GenerateCms2kCorpusOptions = {},
): FixtureDocument[] {
  const count = options.count ?? 200;
  const languages = options.languages ?? ["en", "de"];

  const docs: FixtureDocument[] = [];
  let id = 1;

  for (const language of languages) {
    for (const page of MARKETING_PAGES) {
      const content = page[language];
      if (!content) continue;
      docs.push({
        id: id++,
        url: `/${language}/${page.slug}.html`,
        html: renderPage({
          language,
          title: content.title,
          excerpt: firstSentence(content.body),
          paragraphs: [content.body],
          ...(content.pin ? { pin: content.pin } : {}),
        }),
      });
    }
  }

  const perLanguage = Math.ceil(count / languages.length);
  for (const language of languages) {
    for (let i = 0; i < perLanguage; i++) {
      const topic = TOPICS[i % TOPICS.length] as (typeof TOPICS)[number];
      const paragraphBank = topic[language];
      const adjectives = TITLE_ADJECTIVES[topic.category]?.[language] ?? [];
      const nouns = TITLE_NOUNS[topic.category]?.[language] ?? [];

      const adjective = adjectives[id % adjectives.length] ?? topic.category;
      const noun = nouns[(id + 3) % nouns.length] ?? "";
      const title = noun ? `${adjective} ${noun}` : adjective;

      const start = id % paragraphBank.length;
      const paragraphs = [0, 1, 2, 3].map(
        (offset) =>
          paragraphBank[(start + offset) % paragraphBank.length] as string,
      );

      const tagCount = 1 + (id % topic.tags.length);
      const tagStart = id % topic.tags.length;
      const tags = Array.from(
        { length: tagCount },
        (_, offset) =>
          topic.tags[(tagStart + offset) % topic.tags.length] as string,
      );

      const featured = id % 20 === 0;
      const slug = `${slugify(topic.category)}-${slugify(title)}-${id}`;

      docs.push({
        id: id++,
        url: `/${language}/${slugify(topic.category)}/${slug}.html`,
        html: renderPage({
          language,
          title,
          excerpt: firstSentence(paragraphs[0] as string),
          paragraphs,
          category: topic.category,
          tags: [...new Set(tags)],
          featured,
        }),
      });
      if (docs.length - MARKETING_PAGES.length * languages.length >= count)
        break;
    }
  }

  return docs;
}
