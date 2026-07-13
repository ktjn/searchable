import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@csf/indexer";
import { buildIndex, writeIndex } from "@csf/indexer";
import { escapeHtml, pageShell } from "./gallery-shared.js";
import type { SynonymDoc } from "./gallery-synonyms-data.js";
import { SYNONYM_CONFIG, SYNONYM_DOCS } from "./gallery-synonyms-data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery", "synonyms");
const searchIndexDir = join(galleryDir, "search-index");

function renderDocPage(doc: SynonymDoc): string {
  const bodyHtml = `
      <main>
        <nav><a href="../index.html">&larr; Back to the synonym playground</a></nav>
        <h1>${escapeHtml(doc.title)}</h1>
        <p>${escapeHtml(doc.body)}</p>
      </main>`;
  return pageShell({
    title: doc.title,
    description: doc.body,
    root: "../../../",
    bodyHtml,
  });
}

function renderPlaygroundIndexPage(): string {
  const bodyHtml = `
      <main>
        <p><a href="../../index.html">&larr; Back to docs</a></p>
        <h1>Synonym playground</h1>
        <p>${SYNONYM_DOCS.length} short pages, each written with deliberately
        non-overlapping vocabulary -- one says "couch" and never "sofa", another
        says "sofa" and never "couch" -- so a query only crosses between them
        because synonym expansion ran, not because the words happen to be
        related some other way. "sofa" &harr; "couch" is a symmetric
        equivalence class; "laptop" &rarr; "notebook" is directional (try
        searching "notebook" with expansion on: it won't pull in the laptop
        page, but searching "laptop" pulls in the notebook page). See
        <a href="../../docs/guides/synonyms.html">synonyms</a> for how the
        mechanism works.</p>
        <div
          data-gallery-root
          data-index-path="gallery/synonyms/search-index/manifest.json"
          data-default-query="sofa"
          data-synonyms-toggle="true"
        ></div>
      </main>`;
  return pageShell({
    title: "Synonym playground",
    description:
      "A small corpus with non-overlapping vocabulary, demonstrating synonym expansion.",
    root: "../../",
    bodyHtml,
    withWidget: true,
  });
}

function docToSource(doc: SynonymDoc, id: number): SourceDocument {
  return {
    id,
    url: `/gallery/synonyms/p/${doc.slug}.html`,
    html: renderDocPage(doc),
  };
}

async function main() {
  const sources = SYNONYM_DOCS.map((doc, i) => docToSource(doc, i + 1));

  const built = buildIndex(sources, "en", { synonyms: SYNONYM_CONFIG });
  await writeIndex(built, searchIndexDir);

  await mkdir(join(galleryDir, "p"), { recursive: true });
  for (const source of sources) {
    await writeFile(
      join(distDir, source.url.replace(/^\//, "")),
      source.html,
      "utf8",
    );
  }
  await writeFile(
    join(galleryDir, "index.html"),
    renderPlaygroundIndexPage(),
    "utf8",
  );

  console.log(
    `built synonym playground demo: ${sources.length} pages -> ${galleryDir}`,
  );
}

main();
