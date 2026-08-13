import { SearchClient } from "@ktjn/searchable-client";
import { type StaticServer, serveDirectory } from "@ktjn/searchable-fixtures";
import { evaluateSuite, type SuiteReport } from "./evaluate.js";
import {
  type PythonSourceDocument as SourceDocument,
  writePythonIndex,
} from "./python-index.js";
import type { RelevanceDocument, RelevanceSuite } from "./schema.js";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function facetMetaTags(document: RelevanceDocument): string {
  const tags: string[] = [];
  for (const [field, values] of Object.entries(document.facets ?? {}))
    for (const value of values)
      tags.push(
        `<meta name="searchable-facet-${escapeHtml(field)}" content="${escapeHtml(value)}">`,
      );
  for (const [field, value] of Object.entries(document.rangeFacets ?? {}))
    tags.push(
      `<meta name="searchable-facet-range-${escapeHtml(field)}" content="${value}">`,
    );
  return tags.join("");
}

export async function runSearchableSuite(
  suite: RelevanceSuite,
  k = 5,
): Promise<SuiteReport> {
  let outDirectory: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;
  let server: StaticServer | undefined;
  let client: SearchClient | undefined;
  try {
    const sortedDocuments = [...suite.documents].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const fixtureIdByNumericId = new Map<number, string>();
    const sources: SourceDocument[] = sortedDocuments.map((document, index) => {
      const id = index + 1;
      fixtureIdByNumericId.set(id, document.id);
      return {
        id,
        url: document.url,
        html: `<!doctype html><html lang="${suite.language}"><head><title>${escapeHtml(document.title)}</title>${facetMetaTags(document)}</head><body><main>${escapeHtml(document.body)}</main></body></html>`,
      };
    });
    const built = await writePythonIndex(sources, {
      defaultLanguage: suite.language,
    });
    outDirectory = built.outDir;
    cleanup = built.cleanup;
    server = await serveDirectory(outDirectory);
    client = new SearchClient({
      indexUrl: `${server.baseUrl}manifest.json`,
      strict: true,
    });
    await client.ready();
    return await evaluateSuite(
      suite,
      async (query, options) => {
        const result = await client?.search(query, options);
        return (result?.hits ?? []).map((hit) => {
          const fixtureId = fixtureIdByNumericId.get(hit.id);
          if (!fixtureId)
            throw new Error(`Unknown numeric result id ${hit.id}`);
          return fixtureId;
        });
      },
      k,
    );
  } finally {
    client?.dispose();
    await server?.close();
    await cleanup?.();
  }
}
