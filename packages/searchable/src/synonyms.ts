import { ownProp } from "./analysis/index.js";
import type { SynonymShard } from "./format/index.js";

/** Every other term `term` expands to via the synonym shard's equivalence classes and directional map (docs/guides/synonyms.md). */
export function synonymVariantsFor(
  term: string,
  synonymShard: SynonymShard | undefined,
): string[] {
  if (!synonymShard) return [];
  const variants = new Set<string>();
  for (const group of synonymShard.equivalences ?? []) {
    if (!group.includes(term)) continue;
    for (const variant of group) {
      if (variant !== term) variants.add(variant);
    }
  }
  const directionalVariants = synonymShard.directional
    ? ownProp(synonymShard.directional, term)
    : undefined;
  for (const variant of directionalVariants ?? []) {
    variants.add(variant);
  }
  return [...variants];
}

/**
 * Every other normalized phrase `normalizedPhrase` expands to via the
 * synonym shard's `multiWord` equivalence classes
 * (docs/guides/synonyms.md#synonym-file-format) — symmetric only, no
 * directional multiWord form is defined. `normalizedPhrase` must
 * already be in the same space-joined-analyzed-terms shape
 * `normalizePhrase()`/the indexer's `buildSynonymShards()` produce.
 */
export function multiWordVariantsFor(
  normalizedPhrase: string,
  synonymShard: SynonymShard | undefined,
): string[] {
  if (!synonymShard) return [];
  const variants = new Set<string>();
  for (const group of synonymShard.multiWord ?? []) {
    if (!group.includes(normalizedPhrase)) continue;
    for (const variant of group) {
      if (variant !== normalizedPhrase) variants.add(variant);
    }
  }
  return [...variants];
}
