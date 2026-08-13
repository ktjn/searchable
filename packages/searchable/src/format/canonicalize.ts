/**
 * Recursively sorts object keys (array element order is left alone --
 * it's semantically meaningful for postings/doc-id lists) so the same
 * logical data always serializes to the same bytes regardless of
 * insertion order. `JSON.stringify` alone is deterministic for one
 * producer's own iteration order, but not guaranteed stable across
 * independent producers or a corpus fed in a different order
 * (REVIEW.md#10) -- sorting keys before serializing removes that
 * degree of freedom entirely.
 *
 * Sorting uses code-unit order (`Array.prototype.sort` default) so the
 * canonical form is independent of the host locale. Both the indexer
 * (which writes hashed shard filenames from canonicalized JSON) and the
 * benchmark (which derives workload identity hashes) share this one
 * definition so their hashes can never drift apart.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
