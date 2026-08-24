import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PickupLocation } from "./gallery-locations-data.js";
import { PICKUP_LOCATIONS } from "./gallery-locations-data.js";
import { buildGalleryDemo, escapeHtml, pageShell } from "./gallery-shared.js";
import type { PythonSourceDocument as SourceDocument } from "./python-index.js";
import { writePythonIndex } from "./python-index.js";
import { resolveWidgetScript } from "./vite-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");
const galleryDir = join(distDir, "gallery", "locations");

function renderLocationPage(location: PickupLocation): string {
  const bodyHtml = `
      <main>
        <nav><a href="../index.html">&larr; Back to the store locator</a></nav>
        <h1>${escapeHtml(location.title)}</h1>
        <p class="gallery-meta">${escapeHtml(location.city)}, ${escapeHtml(location.country)}</p>
        <p>${escapeHtml(location.description)}</p>
      </main>`;
  const point = `${location.lat},${location.lon}`;
  return pageShell({
    title: location.title,
    description: location.description,
    root: "../../../",
    bodyHtml,
    meta: [
      `<meta name="searchable-facet-geo-location" content="${point}">`,
      // Geo facets filter but are not returned as stored display fields. Store
      // the same point so the widget can plot each result on its minimap.
      `<meta name="searchable-stored-location" content="${point}">`,
    ],
  });
}

function renderLocatorIndexPage(galleryWidgetScript: string): string {
  const bodyHtml = `
      <main>
        <p><a href="../../index.html">&larr; Back to docs</a></p>
        <h1>Store locator</h1>
        <p>${PICKUP_LOCATIONS.length} distinct pickup locations demonstrate
        radius filtering, distance reporting, nearest-first sorting, and the
        schematic result map. Start near Stockholm or use your device location;
        widen the radius when no sample store is nearby. See
        <a href="../../docs/guides/facets.html#geo-facets">geo facets</a>
        for the index and query shapes.</p>
        <div
          data-gallery-root
          data-index-path="gallery/locations/search-index/manifest.json"
          data-default-query="pickup"
          data-geo-facet="location"
          data-geo-lat="59.3293"
          data-geo-lon="18.0686"
          data-geo-radius="1600"
          data-sort-by-distance="true"
          data-modes="lexical"
        ></div>
      </main>`;
  return pageShell({
    title: "Store locator",
    description:
      "A purpose-built geo-search corpus with one distinct coordinate per pickup location.",
    root: "../../",
    bodyHtml,
    withWidget: true,
    galleryWidgetScript,
  });
}

function locationToSource(location: PickupLocation): SourceDocument {
  return {
    id: location.id,
    url: `/gallery/locations/p/${location.slug}.html`,
    html: renderLocationPage(location),
  };
}

async function main() {
  const galleryWidgetScript = await resolveWidgetScript(
    distDir,
    "gallery-widget",
  );
  const sources = PICKUP_LOCATIONS.map(locationToSource);

  await buildGalleryDemo({
    galleryDir,
    distDir,
    pages: sources,
    indexHtml: renderLocatorIndexPage(galleryWidgetScript),
    buildIndex: () => writePythonIndex(sources, { defaultLanguage: "en" }),
    log: `built store locator demo: ${sources.length} locations -> ${galleryDir}`,
  });
}

main();
