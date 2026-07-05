/**
 * Synonym playground corpus (docs/19-github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5):
 * a handful of docs with deliberately non-overlapping vocabulary, so a
 * query only finds a doc using different wording *because* synonym
 * expansion ran, not by some other route (shared substrings, stemming,
 * etc.) muddying the demo.
 */

export interface SynonymDoc {
  slug: string;
  title: string;
  body: string;
}

export const SYNONYM_DOCS: SynonymDoc[] = [
  {
    slug: "couch-showroom",
    title: "Couch Showroom",
    body: "Browse our couch showroom. We stock couches in every fabric and color, from compact couches to oversized sectional couches.",
  },
  {
    slug: "sofa-collection",
    title: "Sofa Collection",
    body: "Our sofa collection features hand-stitched sofas from top designers. Each sofa is built to last for decades.",
  },
  {
    slug: "loveseat-guide",
    title: "Loveseat Buying Guide",
    body: "A loveseat is a small two-seat option for tight spaces. Loveseats pair well with a single accent chair.",
  },
  {
    slug: "laptop-deals",
    title: "Laptop Deals This Week",
    body: "Laptop deals this week include discounts on ultraportable laptops for students and professionals.",
  },
  {
    slug: "notebook-reviews",
    title: "Notebook Reviews",
    body: "Notebook reviews and comparisons help you pick the right notebook for note-taking and light computing.",
  },
  {
    slug: "desk-lamps",
    title: "Desk Lamps",
    body: "Desk lamps come in adjustable and clip-on styles to brighten any workspace.",
  },
];

/**
 * "sofa"<->"couch" is a symmetric equivalence class; "laptop"->"notebook"
 * is directional (forward only) -- both wired into buildIndex's
 * `synonyms` option in build-gallery-synonyms.ts, mirroring
 * docs/05-synonyms.md's authoring shape exactly.
 */
export const SYNONYM_CONFIG = {
  en: {
    equivalences: [["sofa", "couch"]] as string[][],
    directional: { laptop: ["notebook"] } as Record<string, string[]>,
  },
};
