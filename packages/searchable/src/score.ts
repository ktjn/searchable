import { ownProp } from "./analysis/index.js";
import type { Manifest, Posting } from "./format/index.js";

/** BM25F parameters (docs/guides/ranking-and-boosts.md#ranking-model-bm25f). */
const K1 = 1.2;
const B = 0.75;

function idf(docCount: number, df: number): number {
  return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
}

/**
 * Scores one term's contribution to one document under BM25F: field-
 * weighted term frequency (normalized by that field's length relative
 * to the corpus average), run through the BM25 saturation curve and
 * scaled by idf. `fieldBoostOverrides` lets a caller override the
 * manifest's build-time field weights per-query
 * (docs/guides/ranking-and-boosts.md#boost-types-summarized). `language`
 * selects which partition's corpus-wide stats (docCount, avgFieldLength)
 * to use — a manifest spanning multiple languages keeps these per
 * language, since mixing them would skew idf/length-norm for both
 * (docs/guides/internationalization.md#mixed-language-corpora-and-queries).
 */
export function scoreTermForDoc(
  posting: Posting,
  df: number,
  manifest: Manifest,
  language: string,
  fieldBoostOverrides?: Record<string, number>,
): number {
  const avgFieldLength = ownProp(manifest.avgFieldLength, language) ?? {};
  let weightedTf = 0;
  for (const [field, fieldPosting] of Object.entries(posting.fields)) {
    const boost =
      fieldBoostOverrides?.[field] ?? manifest.fields[field]?.boost ?? 1.0;
    const avgLen = avgFieldLength[field] ?? fieldPosting.len;
    const lengthNorm = 1 - B + B * (fieldPosting.len / (avgLen || 1));
    weightedTf += (boost * fieldPosting.tf) / (lengthNorm || 1);
  }

  const docCount = ownProp(manifest.docCount, language) ?? 0;
  return idf(docCount, df) * (weightedTf / (weightedTf + K1));
}
