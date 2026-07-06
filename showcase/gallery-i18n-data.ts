/**
 * Multi-language corpus for the Stage 2 feature gallery
 * (docs/19-github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5).
 * Scoped to English + German -- the two LanguageProfiles that actually
 * exist today (docs/09-roadmap.md#status, Phase 4) -- rather than the
 * full English/German/Japanese/Arabic list in docs/19's original demo
 * table; CJK segmentation and RTL rendering remain design-only, so a
 * demo claiming to showcase them would be lying.
 *
 * Two things this corpus is built to demonstrate, both true properties
 * of the engine today rather than aspirational ones:
 *   - Language partitioning: "espresso" is spelled identically in
 *     English and German, so searching it while scoped to each
 *     language in turn returns that language's own doc only -- proof
 *     the partitioning is real, not just "different words happen not
 *     to collide."
 *   - Umlaut folding happens in the stemmer, not before it
 *     (docs/03-tokenization-i18n.md#case-folding--diacritics): German
 *     "schon" (already) and "schön" (beautiful) are different words
 *     that happen to differ only by an umlaut. `foldDiacritics: false`
 *     keeps them as distinct strings going *into* stemGerman(), but its
 *     final step folds any remaining umlaut to a plain vowel regardless
 *     -- so the schon/schoen pair below both stem to "schon" and a
 *     search for either one now surfaces both pages, a real,
 *     spec-conforming property of the Snowball German stemmer rather
 *     than a bug.
 */

export interface I18nDoc {
  slug: string;
  language: "en" | "de";
  title: string;
  body: string;
}

export const I18N_DOCS: I18nDoc[] = [
  {
    slug: "espresso-en",
    language: "en",
    title: "Espresso Basics",
    body: "Espresso is a concentrated coffee brewed by forcing hot water through finely-ground beans. A good espresso has a thick crema on top.",
  },
  {
    slug: "mountains-en",
    language: "en",
    title: "Mountain Hiking Tips",
    body: "Hiking in the mountains requires sturdy boots, layered clothing, and plenty of water. Always check the weather before you start.",
  },
  {
    slug: "espresso-de",
    language: "de",
    title: "Espresso Grundlagen",
    body: "Espresso ist ein konzentrierter Kaffee, der durch heißes Wasser und fein gemahlene Bohnen gebrüht wird. Ein guter Espresso hat eine dicke Crema.",
  },
  {
    slug: "berge-de",
    language: "de",
    title: "Wandern in den Bergen",
    body: "Wandern in den Bergen erfordert feste Schuhe, mehrere Kleidungsschichten und ausreichend Wasser. Prüfen Sie immer das Wetter, bevor Sie starten.",
  },
  {
    slug: "schon-de",
    language: "de",
    title: "Schon unterwegs",
    body: "Wir sind schon unterwegs und kommen bald an. Schon jetzt freuen wir uns auf die Reise.",
  },
  {
    slug: "schoen-de",
    language: "de",
    title: "Schöne Aussicht",
    body: "Die Aussicht von hier ist wirklich schön. Ein schöner Tag für eine Wanderung mit schöner Aussicht.",
  },
];
