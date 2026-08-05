import type { Posting } from "@ktjn/searchable-format";

/** Whether `phraseTokens` appears as a contiguous run inside `queryTokens` (docs/guides/pinning.md#authoring, contains mode). */
export function containsPhrase(
  queryTokens: string[],
  phraseTokens: string[],
): boolean {
  if (phraseTokens.length === 0 || phraseTokens.length > queryTokens.length) {
    return false;
  }
  for (let i = 0; i <= queryTokens.length - phraseTokens.length; i++) {
    if (phraseTokens.every((t, j) => queryTokens[i + j] === t)) return true;
  }
  return false;
}

/**
 * True if `docPostings` (one per phrase term, in order, all for the
 * same document) contain, for at least one shared field, a run of
 * consecutive positions matching that order -- i.e. the words
 * genuinely appear as an adjacent phrase in that field, not just
 * independently somewhere in the document
 * (docs/guides/ranking-and-boosts.md#phrase-and-proximity-queries). A
 * missing posting for any term (shouldn't happen -- callers only pass
 * doc ids already confirmed present in every term's postings) makes
 * this vacuously false rather than throwing.
 */
export function hasConsecutivePositions(
  docPostings: (Posting | undefined)[],
): boolean {
  if (docPostings.length === 0 || docPostings.some((p) => !p)) return false;
  const first = docPostings[0];
  if (!first) return false;
  for (const field of Object.keys(first.fields)) {
    const positionSets = docPostings.map((p) => {
      const positions = p?.fields[field]?.pos;
      return positions ? new Set(positions) : undefined;
    });
    if (positionSets.some((s) => !s)) continue; // this field doesn't carry every term
    const startPositions = positionSets[0];
    if (!startPositions) continue;
    for (const start of startPositions) {
      let matched = true;
      for (let i = 1; i < positionSets.length; i++) {
        if (!positionSets[i]?.has(start + i)) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
  }
  return false;
}
