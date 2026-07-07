/**
 * Own-property-safe read of a plain-object dictionary keyed by a
 * caller/content-derived string (a query term, a fuzzy deletion
 * variant, or `SearchOptions.language` -- a public, caller-supplied
 * field). A bare `dict[key]` (or `dict[key] ?? fallback`) is fooled by
 * the prototype chain when `key` happens to be an inherited
 * `Object.prototype` member name (`"constructor"`, `"toString"`,
 * `"valueOf"`, `"hasOwnProperty"`, `"__proto__"`, ...): `dict[key]` then
 * returns that inherited function (truthy, and non-nullish, so `?? x`
 * never kicks in either), and code that assumes the result has the real
 * entry's shape crashes or silently misbehaves. A search for exactly
 * that word, or `search(query, { language: "constructor" })`, is all it
 * takes -- see the matching helper on the indexer's write side
 * (`packages/indexer/src/safe-dict.ts`) for the build-time half of this
 * same bug class.
 */
export function ownProp<T>(
  dict: Record<string, T>,
  key: string,
): T | undefined {
  return Object.hasOwn(dict, key) ? dict[key] : undefined;
}
