import type { TokenSpan } from "./language-profile.js";

/**
 * Shared run-scanning core behind every n-gram-fallback `LanguageProfile`
 * segmenter (`segment-cjk.ts`'s bigram Han/kana profile, `segment-sea.ts`'s
 * trigram Thai/Khmer/Lao profile): split `text` into alternating runs of
 * `isInScript`-matching characters and everything else, window each
 * script run into overlapping `n`-character spans (or, if the run is
 * shorter than `n`, index it as one whole span rather than dropping it),
 * and segment each non-script run normally via `Intl.Segmenter` -- these
 * scripts routinely mix in Latin words, digits, and punctuation that
 * deserve ordinary word-boundary matching, not n-gram windowing.
 */

const nonScriptSegmenter = new Intl.Segmenter("en", { granularity: "word" });

function segmentNonScriptRun(run: string): TokenSpan[] {
  return Array.from(nonScriptSegmenter.segment(run), (s) => ({
    text: s.segment,
    isWordLike: s.isWordLike ?? false,
  }));
}

function segmentScriptRun(run: string[], n: number): TokenSpan[] {
  if (run.length < n) {
    return [{ text: run.join(""), isWordLike: true }];
  }
  const spans: TokenSpan[] = [];
  for (let i = 0; i <= run.length - n; i++) {
    spans.push({ text: run.slice(i, i + n).join(""), isWordLike: true });
  }
  return spans;
}

export function segmentByScriptNgram(
  text: string,
  isInScript: (ch: string) => boolean,
  n: number,
): TokenSpan[] {
  const chars = [...text];
  const spans: TokenSpan[] = [];
  let i = 0;
  while (i < chars.length) {
    const inScript = isInScript(chars[i] as string);
    let j = i;
    while (j < chars.length && isInScript(chars[j] as string) === inScript) j++;
    const run = chars.slice(i, j);
    spans.push(
      ...(inScript
        ? segmentScriptRun(run, n)
        : segmentNonScriptRun(run.join(""))),
    );
    i = j;
  }
  return spans;
}
