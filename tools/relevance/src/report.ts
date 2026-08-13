import type { SuiteReport } from "./evaluate.js";

function fixed(value: number): string {
  return value.toFixed(6);
}

export function renderConsoleReport(reports: readonly SuiteReport[]): string {
  return reports
    .map(
      (report) => `${report.language}  ${report.suiteId}@${report.suiteVersion}
  ${report.documentCount} documents, ${report.queryCount} queries, k=${report.k}
  MRR ${fixed(report.metrics.meanReciprocalRank)}  P@k ${fixed(report.metrics.meanPrecisionAtK)}  R@k ${fixed(report.metrics.meanRecallAtK)}  nDCG@k ${fixed(report.metrics.meanNdcgAtK)}  zero ${fixed(report.metrics.zeroResultRate)}
  Source: ${report.provenance.publisher} — ${report.provenance.sourceUrl}`,
    )
    .join("\n\n");
}

function rounded(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rounded(entry)]),
    );
  return value;
}

export function serializeJsonReport(
  reports: readonly SuiteReport[],
  k: number,
): string {
  return `${JSON.stringify(rounded({ schemaVersion: 1, k, suites: reports }), null, 2)}\n`;
}
