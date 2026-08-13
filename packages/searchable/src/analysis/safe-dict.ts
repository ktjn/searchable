/**
 * Own-property-safe helpers for a plain-object dictionary keyed by a
 * corpus- or query-derived string (a term, a facet field/value, a
 * fuzzy deletion variant, a query's `language` override...). A bare
 * `if (!dict[key])` existence check (or the `in` operator, or
 * `dict[key] ?? fallback`) is fooled by the prototype chain whenever
 * `key` happens to collide with an inherited `Object.prototype` member
 * name (`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`,
 * `"__proto__"`, ...): `dict[key]` then returns that inherited function
 * (truthy, and non-nullish, so `?? x` never kicks in either; `in` sees
 * it too), so code that assumes the result has the real entry's shape
 * crashes or silently misbehaves. A document containing the word
 * "constructor" in prose, a `searchable-facet-constructor` meta tag, or a
 * search for the literal word "constructor" is all it takes — not a
 * hypothetical, this exact bug crashed a real `buildIndex()` run and
 * corrupted query-time scores (`docs/reference/compatibility.md`, from
 * back when the now-removed TypeScript indexer built the index too).
 * The build-time side is now `python/searchable-indexer`, whose plain
 * `dict`s aren't fooled by a prototype chain the way JS objects are, so
 * this bug class -- and this helper -- is specific to the query-time,
 * TypeScript side (`@ktjn/searchable-client`, which depends on this
 * package).
 */

/** Own-property-safe read (no creation) — `undefined` when `key` isn't a real own entry, never an inherited `Object.prototype` member. */
export function ownProp<T>(
  dict: Record<string, T>,
  key: string,
): T | undefined {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}
