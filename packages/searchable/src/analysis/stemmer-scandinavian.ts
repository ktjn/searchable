export function markScandinavianRegion(
  word: string,
  vowels: ReadonlySet<string>,
): number {
  let index = 0;
  while (index < word.length && !vowels.has(word[index] as string)) index++;
  while (index < word.length && vowels.has(word[index] as string)) index++;
  if (index < word.length) index++;
  return Math.max(3, index);
}

export function longestSuffixInRegion(
  word: string,
  regionStart: number,
  suffixes: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const suffix of suffixes) {
    const start = word.length - suffix.length;
    if (
      start >= regionStart &&
      word.endsWith(suffix) &&
      (best === undefined || suffix.length > best.length)
    ) {
      best = suffix;
    }
  }
  return best;
}
