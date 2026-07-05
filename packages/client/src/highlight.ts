/**
 * Result highlighting (docs/08-modern-features.md#highlighting--snippets):
 * splits a stored field's text into match/non-match spans for the
 * literal query terms actually typed, so a consumer can render its own
 * `<mark>` (or any other) wrapper around `isMatch` spans without a
 * `dangerouslySetInnerHTML` step.
 *
 * Scoped to literal terms only (prefix-aware for `term*`) -- a hit
 * that only matched via synonym expansion or fuzzy correction won't
 * have that expanded term highlighted, only whatever the user actually
 * typed. This is a real gap, not an oversight: tracking exactly which
 * real term matched a given hit through synonym/fuzzy expansion isn't
 * implemented in `search()`'s clause-scoring loop today (clauses don't
 * currently carry the literal term string of each expansion match),
 * and highlighting a term the user never typed with no way to
 * distinguish it from what they searched for would be confusing rather
 * than helpful, so it's better left for a future slice than bolted on
 * incorrectly here.
 *
 * Also scoped to whatever text is already stored (title, excerpt) --
 * not the full body, which the doc store deliberately doesn't retain
 * (docs/02-index-format.md). Stored per-field token *positions*
 * (`FieldPosting.pos`) exist for the full body's tokenization, but an
 * excerpt is either author-supplied (`<meta name="description">`) or a
 * plain character-length truncation of the body -- neither reliably
 * lines up with body token indices, so highlighting here is done by
 * matching directly against the stored text rather than trying to
 * reuse body positions that don't actually describe it.
 */

export interface HighlightSpan {
  text: string;
  isMatch: boolean;
}

export interface HighlightTerm {
  term: string;
  prefix: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds one alternation pattern from every term, longest first, so a
 * longer term that contains a shorter one as a substring (e.g. "cat"
 * and "category") doesn't get shadowed by the shorter match winning
 * first in the alternation. Word-boundary (`\b`) anchored -- correct
 * for Latin-script terms (English/German, the only LanguageProfiles
 * that exist today); `\b` is not script-aware for e.g. CJK, a
 * limitation to revisit alongside the CJK segmentation work itself.
 */
function buildPattern(terms: HighlightTerm[]): RegExp | undefined {
  const unique = [
    ...new Map(terms.map((t) => [`${t.term}:${t.prefix}`, t])).values(),
  ];
  if (unique.length === 0) return undefined;
  const parts = unique
    .sort((a, b) => b.term.length - a.term.length)
    .map((t) => `\\b${escapeRegExp(t.term)}${t.prefix ? "\\w*" : "\\b"}`);
  return new RegExp(`(${parts.join("|")})`, "giu");
}

/**
 * Splits `text` into spans around every case-insensitive match of any
 * of `terms`. Returns a single non-match span containing the whole
 * text when there are no terms or no matches, so callers can always
 * render `spans.map(...)` uniformly rather than special-casing "no
 * highlights."
 */
export function highlightText(
  text: string,
  terms: HighlightTerm[],
): HighlightSpan[] {
  const pattern = buildPattern(terms);
  if (!pattern || !text) return [{ text, isMatch: false }];

  const spans: HighlightSpan[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > lastIndex) {
      spans.push({ text: text.slice(lastIndex, index), isMatch: false });
    }
    spans.push({ text: match[0], isMatch: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    spans.push({ text: text.slice(lastIndex), isMatch: false });
  }
  return spans.length ? spans : [{ text, isMatch: false }];
}
