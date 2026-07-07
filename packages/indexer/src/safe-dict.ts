/**
 * Own-property-safe "get or create" for a plain-object dictionary keyed
 * by corpus-derived strings (a term, a facet field/value, a fuzzy
 * deletion variant...) — a bare `if (!obj[key])` existence check (or
 * the `in` operator) is fooled by the prototype chain when `key`
 * happens to collide with an inherited `Object.prototype` member
 * (`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`,
 * `"__proto__"`, ...): `obj[key]` then returns that inherited function
 * (truthy, and `in` sees it too), so the real entry never gets created,
 * and code that assumes the returned value has the real entry's shape
 * (e.g. `entry.postings.push(...)`, `values.push(...)`) crashes or
 * silently drops the value. A document whose content happens to
 * contain one of those words as a token or a `csf-facet-<field>` name
 * is all it takes — not a hypothetical, this exact crash is what
 * `docs/25-path-to-1.0.md`'s own text (containing the word
 * "constructor") triggered when the showcase indexed it.
 */
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

/** Same own-property-safety as `getOrCreate` above, for a plain read (no creation) against a caller-supplied config dictionary keyed by corpus-derived strings (e.g. a facet field name). */
export function ownProp<T>(obj: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}
