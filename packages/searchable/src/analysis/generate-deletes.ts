/** Return every unique Unicode code-point deletion through `maxEdits`. */
export function generateDeletes(term: string, maxEdits: 1 | 2): string[] {
  let frontier = new Set([term]);
  const all = new Set(frontier);
  for (let depth = 0; depth < maxEdits; depth++) {
    const next = new Set<string>();
    for (const variant of frontier) {
      const chars = [...variant];
      for (let index = 0; index < chars.length; index++) {
        next.add(
          chars.slice(0, index).join("") + chars.slice(index + 1).join(""),
        );
      }
    }
    for (const variant of next) all.add(variant);
    frontier = next;
  }
  return [...all];
}
