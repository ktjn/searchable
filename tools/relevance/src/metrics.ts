import type { RelevanceGrade } from "./schema.js";

export type Judgments = Readonly<Record<string, RelevanceGrade>>;

function requireCutoff(k: number): void {
  if (!Number.isInteger(k) || k <= 0)
    throw new Error("k must be a positive integer");
}

function relevant(id: string, judgments: Judgments): boolean {
  return (judgments[id] ?? 0) >= 1;
}

export function reciprocalRank(
  returnedIds: readonly string[],
  judgments: Judgments,
): number {
  const index = returnedIds.findIndex((id) => relevant(id, judgments));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function precisionAtK(
  returnedIds: readonly string[],
  judgments: Judgments,
  k: number,
): number {
  requireCutoff(k);
  return (
    returnedIds.slice(0, k).filter((id) => relevant(id, judgments)).length / k
  );
}

export function recallAtK(
  returnedIds: readonly string[],
  judgments: Judgments,
  k: number,
): number {
  requireCutoff(k);
  const total = Object.values(judgments).filter((grade) => grade >= 1).length;
  return (
    returnedIds.slice(0, k).filter((id) => relevant(id, judgments)).length /
    total
  );
}

function dcg(grades: readonly number[]): number {
  return grades.reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

export function ndcgAtK(
  returnedIds: readonly string[],
  judgments: Judgments,
  k: number,
): number {
  requireCutoff(k);
  const actual = returnedIds.slice(0, k).map((id) => judgments[id] ?? 0);
  const ideal = Object.values(judgments)
    .sort((a, b) => b - a)
    .slice(0, k);
  return dcg(actual) / dcg(ideal);
}

export function isZeroResult(returnedIds: readonly string[]): boolean {
  return returnedIds.length === 0;
}

export interface RankingMetrics {
  reciprocalRank: number;
  precisionAtK: number;
  recallAtK: number;
  ndcgAtK: number;
  zeroResult: boolean;
}

export function evaluateRanking(
  returnedIds: readonly string[],
  judgments: Judgments,
  k: number,
): RankingMetrics {
  requireCutoff(k);
  const seen = new Set<string>();
  for (const id of returnedIds) {
    if (seen.has(id)) throw new Error(`duplicate result id ${id}`);
    seen.add(id);
  }
  return {
    reciprocalRank: reciprocalRank(returnedIds, judgments),
    precisionAtK: precisionAtK(returnedIds, judgments, k),
    recallAtK: recallAtK(returnedIds, judgments, k),
    ndcgAtK: ndcgAtK(returnedIds, judgments, k),
    zeroResult: isZeroResult(returnedIds),
  };
}
