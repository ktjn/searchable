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
 * corrupted query-time scores (`docs/reference/compatibility.md`). Shared here,
 * not duplicated separately in `@ktjn/searchable-indexer` and `@ktjn/searchable-client`, since
 * both already depend on this package and the bug class is identical on
 * both the build-time and query-time side.
 */

/** Own-property-safe "get or create": creates and stores `create()`'s result the first time `key` is seen, otherwise returns the existing entry — never fooled into treating an inherited prototype member as an existing entry. */
export function getOrCreate<T>(
  obj: Record<string, T>,
  key: string,
  create: () => T,
): T {
  if (Object.hasOwn(obj, key)) return obj[key] as T;
  const value = create();
  obj[key] = value;
  return value;
}

/** Own-property-safe read (no creation) — `undefined` when `key` isn't a real own entry, never an inherited `Object.prototype` member. */
export function ownProp<T>(
  dict: Record<string, T>,
  key: string,
): T | undefined {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}
