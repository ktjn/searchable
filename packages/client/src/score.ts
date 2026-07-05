import type { Manifest, Posting } from "@csf/format";

/** BM25F parameters (docs/04-query-ranking-boosts.md#ranking-model-bm25f). */
const K1 = 1.2;
const B = 0.75;

function idf(docCount: number, df: number): number {
  return Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
}

/**
 * Scores one term's contribution to one document under BM25F: field-
 * weighted term frequency (normalized by that field's length relative
 * to the corpus average), run through the BM25 saturation curve and
 * scaled by idf. Field boosts default to 1.0 until manifests carry
 * non-default weights (docs/09-roadmap.md Phase 2).
 */
export function scoreTermForDoc(
  posting: Posting,
  df: number,
  manifest: Manifest,
): number {
  let weightedTf = 0;
  for (const [field, fieldPosting] of Object.entries(posting.fields)) {
    const boost = manifest.fields[field]?.boost ?? 1.0;
    const avgLen = manifest.avgFieldLength[field] ?? fieldPosting.len;
    const lengthNorm = 1 - B + B * (fieldPosting.len / (avgLen || 1));
    weightedTf += (boost * fieldPosting.tf) / (lengthNorm || 1);
  }

  return idf(manifest.docCount, df) * (weightedTf / (weightedTf + K1));
}
