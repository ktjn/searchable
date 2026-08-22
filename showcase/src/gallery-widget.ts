/**
 * Loaded on every Stage 2 feature-gallery demo page via
 * <script type="module"> (docs/archive/roadmaps/github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5).
 * Unlike search-widget.ts (a fixed docs-search-box UX), this widget is
 * data-driven off its mount point's attributes so one script serves
 * every gallery demo (product catalog today, synonym playground /
 * multi-language corpus / typo-tolerance reusing the same shape later)
 * without a per-demo copy:
 *
 *   <div data-gallery-root
 *        data-index-path="gallery/<demo>/search-index/manifest.json"
 *        data-default-query="..."      (shown/used before the visitor types)
 *        data-facets="field1,field2"   (comma list of facet fields to render as checkboxes)
 *        data-range-facets="field"     (comma list of numeric range-facet fields -> min/max filter inputs)
 *        data-geo-facet="field"        (one geo-facet field -> lat/lon/radius inputs, a sort-by-distance toggle,
 *                                        a "Use my location" button (navigator.geolocation), and a schematic
 *                                        straight-line-distance map of the origin + result locations)
 *        data-geo-lat="51.5074"        (optional preset for the latitude input, so the effect is visible without typing first)
 *        data-geo-lon="-0.1278"        (optional preset for the longitude input)
 *        data-geo-radius="6500"        (optional preset for the radius (km) input)
 *        data-sort-by-distance="true"  (optional -> pre-check the sort-by-distance toggle)
 *        data-exact-fields="field1,f2" (comma list of stored-but-unfaceted fields -> exact-match text inputs, docs/guides/facets.md#exact-match-on-stored-fields)
 *        data-exact-values="f1=v1,f2=v2" (optional presets for those exact-match inputs)
 *        data-fuzzy-toggle="true"      (omit to hide the fuzzy on/off control)
 *        data-synonyms-toggle="true"   (omit to hide the synonym-expansion on/off control)
 *        data-languages="en,de">       (comma list -> a language <select>; omit to use manifest.defaultLanguage)
 *        data-operator="and|or"        (present -> an AND/OR <select>; omit for the default "and")
 *        (retrieval-mode selection removed in 2.0; lexical only)
 *        data-highlight="true"         (pass highlight:true and render <mark> spans from hit.highlights)
 *        data-boost-fields="title=3"   (csv "field=mult" -> a checkbox re-ranking that field per query)
 *        data-boost-terms="term=5"     (csv "term=mult" -> a checkbox re-ranking that term per query)
 *        data-fuzzy-weight="0.3"       (numeric input tuning fuzzyWeight, only when the fuzzy toggle is on)
 *        data-synonym-weight="0.3"     (numeric input tuning synonymWeight, only when the synonyms toggle is on)
 *        data-browse="true">           (empty query -> a facet-only panel via client.facetValues)
 *   </div>
 *
 * When a fuzzy/synonyms toggle is on, a hit that only appears because of
 * that expansion (not found by a literal-only baseline search) is
 * labeled with a badge -- docs/archive/roadmaps/github-pages-showcase.md's Stage 2
 * asks for the mechanism to be "visibly labeled ... not just 'it
 * worked'", so this diffs against a second, unexpanded search rather
 * than asserting the toggle worked without evidence.
 *
 * Same import.meta.url-anchored site-root resolution as search-widget.ts
 * -- this script is deployed once at the site root regardless of how
 * deeply nested the page that loads it is. Also bundled and
 * content-hashed by Vite the same way, for the same reason -- see
 * search-widget.ts's doc comment for the full rationale.
 */

interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  pinned?: boolean;
  highlights?: Record<string, HighlightSpan[]>;
  distanceKm?: number;
}

interface HighlightSpan {
  text: string;
  isMatch: boolean;
}

interface FacetResultValue {
  value: string;
  count: number;
  selected: boolean;
}

interface FacetResult {
  values: FacetResultValue[];
}

interface SearchResult {
  hits: Hit[];
  facets?: Record<string, FacetResult>;
  totalHits: number;
  didYouMean?: string[];
}

interface RangeFilter {
  min?: number;
  max?: number;
}

interface GeoFilter {
  lat: number;
  lon: number;
  radiusKm: number;
}

interface SearchOptions {
  language?: string;
  limit?: number;
  filters?: Record<string, string | string[] | RangeFilter | GeoFilter>;
  facets?: string[];
  fuzzy?: boolean;
  fuzzyWeight?: number;
  synonyms?: boolean;
  synonymWeight?: number;
  operator?: "and" | "or";
  highlight?: boolean;
  mode?: "lexical";
  sortByDistance?: boolean;
  boosts?: {
    fields?: Record<string, number>;
    terms?: Record<string, number>;
  };
}

interface SearchClientLike {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  facetValues?(
    field: string,
    options?: { filters?: SearchOptions["filters"] },
  ): Promise<FacetResult>;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  sv: "Svenska",
  nl: "Nederlands",
  nb: "Norsk bokmål",
  nn: "Norsk nynorsk",
};

function parseNumberInput(value: string): number | undefined {
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface BoostSpecEntry {
  key: string;
  multiplier: number;
}

function parseBoostSpec(spec: string | undefined): BoostSpecEntry[] {
  if (!spec) return [];
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const [key, rawMultiplier] = part.split("=");
      const multiplier = Number(rawMultiplier);
      if (!key || !Number.isFinite(multiplier)) return [];
      return [{ key, multiplier }];
    });
}

/** Parses "field1=value1,field2=value2" into a field -> preset-value map, for prefilling exact-match inputs (data-exact-values). */
function parseExactValueSpec(spec: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!spec) return out;
  for (const part of spec
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return out;
}

/** Parses a stored "lat,lon" field value (docs/guides/facets.md#geo-facets) for the geo minimap. */
function parseStoredPoint(
  raw: string | undefined,
): { lat: number; lon: number } | undefined {
  if (!raw) return undefined;
  const [rawLat, rawLon] = raw.split(",");
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { lat, lon };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Builds a schematic (not real-cartography) plot of a geo search: the query
 * origin, its radius, and where the current result set's own geo-faceted
 * field puts each hit -- flat-earth-projected in kilometers around the
 * origin (or the first point, if there's no origin yet) so distances stay
 * roughly to scale close in, without pulling in map tiles or an API key.
 * Returns undefined when there's nothing to plot.
 */
function renderGeoMapSvg(
  origin: { lat: number; lon: number } | undefined,
  radiusKm: number | undefined,
  points: Array<{ lat: number; lon: number; label: string }>,
): SVGSVGElement | undefined {
  const anchor = origin ?? points[0];
  if (!anchor) return undefined;

  const kmPerDegLat = 111;
  const kmPerDegLon = 111 * Math.cos((anchor.lat * Math.PI) / 180);
  const project = (lat: number, lon: number): { x: number; y: number } => ({
    x: (lon - anchor.lon) * kmPerDegLon,
    y: -(lat - anchor.lat) * kmPerDegLat, // flip so north is up
  });

  const originXY = origin ? project(origin.lat, origin.lon) : undefined;
  const plotted = points.map((point) => ({
    ...project(point.lat, point.lon),
    label: point.label,
  }));

  const xs = plotted.map((p) => p.x);
  const ys = plotted.map((p) => p.y);
  if (originXY) {
    xs.push(originXY.x);
    ys.push(originXY.y);
  }
  if (originXY && radiusKm !== undefined) {
    xs.push(originXY.x - radiusKm, originXY.x + radiusKm);
    ys.push(originXY.y - radiusKm, originXY.y + radiusKm);
  }
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const padding = 0.2;
  const viewW = spanX * (1 + padding * 2);
  const viewH = spanY * (1 + padding * 2);
  const offsetX = Math.min(...xs) - spanX * padding;
  const offsetY = Math.min(...ys) - spanY * padding;
  const scale = Math.max(spanX, spanY);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `${offsetX} ${offsetY} ${viewW} ${viewH}`);
  svg.setAttribute("class", "gallery-geo-map");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Schematic map of the search origin, its radius, and the current results' locations, plotted by straight-line distance",
  );

  // A visible frame behind everything else -- without it, a sparse point
  // set with no active radius filter renders as a couple of small dots
  // adrift on a transparent background, easy to miss entirely rather than
  // read as a map.
  const frame = document.createElementNS(SVG_NS, "rect");
  frame.setAttribute("x", String(offsetX));
  frame.setAttribute("y", String(offsetY));
  frame.setAttribute("width", String(viewW));
  frame.setAttribute("height", String(viewH));
  frame.setAttribute("class", "gallery-geo-map-frame");
  svg.append(frame);

  if (originXY && radiusKm !== undefined) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(originXY.x));
    circle.setAttribute("cy", String(originXY.y));
    circle.setAttribute("r", String(radiusKm));
    circle.setAttribute("class", "gallery-geo-map-radius");
    circle.setAttribute("stroke-width", String(scale / 200));
    svg.append(circle);
  }

  for (const point of plotted) {
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("cx", String(point.x));
    marker.setAttribute("cy", String(point.y));
    marker.setAttribute("r", String(scale / 45));
    marker.setAttribute("class", "gallery-geo-map-point");
    marker.setAttribute("stroke-width", String(scale / 300));
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = point.label;
    marker.append(title);
    svg.append(marker);
  }

  if (originXY) {
    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("cx", String(originXY.x));
    marker.setAttribute("cy", String(originXY.y));
    marker.setAttribute("r", String(scale / 35));
    marker.setAttribute("class", "gallery-geo-map-origin");
    marker.setAttribute("stroke-width", String(scale / 300));
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = "Search origin";
    marker.append(title);
    svg.append(marker);
  }

  return svg;
}

const siteRoot = new URL(".", import.meta.url);
const RESULT_LIMIT = 4;

const galleryRoots = document.querySelectorAll<HTMLDivElement>(
  "[data-gallery-root]",
);
for (let i = 0; i < galleryRoots.length; i++) {
  const root = galleryRoots[i] as HTMLDivElement;
  void initGallery(root).catch((error: unknown) => {
    root.replaceChildren();
    const message = document.createElement("p");
    message.className = "gallery-error";
    message.setAttribute("role", "alert");
    message.textContent =
      "This example could not load. Try refreshing the page.";
    root.append(message);
    console.error("Failed to initialize showcase example", error);
  });
}

async function initGallery(root: HTMLDivElement): Promise<void> {
  const indexPath = root.dataset.indexPath;
  if (!indexPath) return;

  const loading = document.createElement("p");
  loading.className = "gallery-loading";
  loading.setAttribute("role", "status");
  loading.textContent = "Loading example";
  root.replaceChildren(loading);

  const defaultQuery = root.dataset.defaultQuery ?? "";
  const facetFields = (root.dataset.facets ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const rangeFacetFields = (root.dataset.rangeFacets ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const geoFacetField = root.dataset.geoFacet?.trim() || undefined;
  const geoLatPreset = parseNumberInput(root.dataset.geoLat ?? "");
  const geoLonPreset = parseNumberInput(root.dataset.geoLon ?? "");
  const geoRadiusPreset = parseNumberInput(root.dataset.geoRadius ?? "");
  const sortByDistancePreset = root.dataset.sortByDistance === "true";
  const exactFields = (root.dataset.exactFields ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const exactValuePresets = parseExactValueSpec(root.dataset.exactValues);
  const showFuzzyToggle = root.dataset.fuzzyToggle === "true";
  const showSynonymsToggle = root.dataset.synonymsToggle === "true";
  const languageCodes = (root.dataset.languages ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const showHighlight = root.dataset.highlight === "true";
  const browseOnly = root.dataset.browse === "true";
  const operator =
    root.dataset.operator === "or" ? ("or" as const) : ("and" as const);
  const boostFields = parseBoostSpec(root.dataset.boostFields);
  const boostTerms = parseBoostSpec(root.dataset.boostTerms);
  const fuzzyWeight = Number(root.dataset.fuzzyWeight);
  const synonymWeight = Number(root.dataset.synonymWeight);

  const { SearchClient } = await import("@ktjn/searchable");

  const client: SearchClientLike = new SearchClient({
    indexUrl: new URL(indexPath, siteRoot).href,
  });

  const controls = document.createElement("div");
  controls.className = "gallery-controls";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "gallery-search-input";
  input.placeholder = "Search…";
  input.value = defaultQuery;
  input.name = "gallery-search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search this demo");
  controls.append(input);

  let selectedLanguage: string | undefined = languageCodes[0];
  if (languageCodes.length > 1) {
    const select = document.createElement("select");
    select.className = "gallery-language-select";
    select.setAttribute("aria-label", "Language");
    for (const code of languageCodes) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = LANGUAGE_LABELS[code] ?? code;
      select.append(option);
    }
    select.addEventListener("change", () => {
      selectedLanguage = select.value;
      void runSearch();
    });
    controls.append(select);
  }

  let fuzzyEnabled = false;
  if (showFuzzyToggle) {
    const label = document.createElement("label");
    label.className = "gallery-toggle gallery-fuzzy-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      fuzzyEnabled = checkbox.checked;
      void runSearch();
    });
    label.append(
      checkbox,
      document.createTextNode(" Fuzzy matching (typo-tolerant)"),
    );
    controls.append(label);
  }

  let synonymsEnabled = false;
  if (showSynonymsToggle) {
    const label = document.createElement("label");
    label.className = "gallery-toggle gallery-synonyms-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      synonymsEnabled = checkbox.checked;
      void runSearch();
    });
    label.append(checkbox, document.createTextNode(" Synonym expansion"));
    controls.append(label);
  }

  // --- per-query weight knobs (docs/guides/ranking-and-boosts.md#boost-types-summarized) ---
  const fuzzyWeightValue = Number.isFinite(fuzzyWeight)
    ? fuzzyWeight
    : undefined;
  const synonymWeightValue = Number.isFinite(synonymWeight)
    ? synonymWeight
    : undefined;
  const fuzzyWeightKnob = addWeightKnob(
    "Fuzzy weight",
    "Fuzzy match weight",
    showFuzzyToggle,
    fuzzyWeightValue,
  );
  const synonymWeightKnob = addWeightKnob(
    "Synonym weight",
    "Synonym match weight",
    showSynonymsToggle,
    synonymWeightValue,
  );
  function addWeightKnob(
    labelText: string,
    ariaLabel: string,
    enabled: boolean,
    initialValue: number | undefined,
  ): HTMLInputElement | undefined {
    if (!enabled || initialValue === undefined) return undefined;
    const label = document.createElement("label");
    label.className = "gallery-toggle";
    const knob = document.createElement("input");
    knob.type = "number";
    knob.className = "gallery-weight-input";
    knob.min = "0";
    knob.max = "1";
    knob.step = "0.1";
    knob.value = String(initialValue);
    knob.setAttribute("aria-label", ariaLabel);
    knob.addEventListener("input", () => void runSearch());
    label.append(document.createTextNode(`${labelText}: `), knob);
    controls.append(label);
    return knob;
  }

  // --- AND/OR query operator (docs/guides/ranking-and-boosts.md#query-input-forms) ---
  let selectedOperator: "and" | "or" = operator;
  if (root.dataset.operator !== undefined) {
    const select = document.createElement("select");
    select.className = "gallery-operator-select";
    select.setAttribute("aria-label", "Query operator");
    for (const value of ["and", "or"] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.toUpperCase();
      select.append(option);
    }
    select.value = selectedOperator;
    select.addEventListener("change", () => {
      selectedOperator = select.value as "and" | "or";
      void runSearch();
    });
    controls.append(select);
  }

  const activeFieldBoosts = new Map<string, number>();
  const activeTermBoosts = new Map<string, number>();
  const boostToggle = (
    entries: BoostSpecEntry[],
    formatter: (entry: BoostSpecEntry) => string,
    active: Map<string, number>,
  ): void => {
    for (const entry of entries) {
      const label = document.createElement("label");
      label.className = "gallery-toggle gallery-boost-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) active.set(entry.key, entry.multiplier);
        else active.delete(entry.key);
        void runSearch();
      });
      label.append(checkbox, document.createTextNode(formatter(entry)));
      controls.append(label);
    }
  };
  boostToggle(
    boostFields,
    (entry) => ` Boost field "${entry.key}" \u00d7${entry.multiplier}`,
    activeFieldBoosts,
  );
  boostToggle(
    boostTerms,
    (entry) => ` Boost term "${entry.key}" \u00d7${entry.multiplier}`,
    activeTermBoosts,
  );

  const body = document.createElement("div");
  body.className = "gallery-body";

  const facetsPane = document.createElement("div");
  facetsPane.className = "gallery-facets";
  body.append(facetsPane);

  const resultsPane = document.createElement("div");
  resultsPane.className = "gallery-results";
  body.append(resultsPane);

  // Range/geo/exact-match filters live in persistent inputs, so
  // re-rendering the checkbox facet groups on every search must not
  // clobber them (nor steal focus).
  const rangeSection = document.createElement("div");
  const geoSection = document.createElement("div");
  const exactSection = document.createElement("div");
  const checkboxSection = document.createElement("div");
  facetsPane.append(rangeSection, geoSection, exactSection, checkboxSection);

  const rangeStates = new Map<
    string,
    { min: number | undefined; max: number | undefined }
  >();
  for (const field of rangeFacetFields) {
    const group = document.createElement("fieldset");
    group.className = "gallery-facet-group gallery-range-facet";
    const legend = document.createElement("legend");
    legend.textContent = field;
    group.append(legend);
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.className = "gallery-range-input";
    minInput.placeholder = "Min";
    minInput.setAttribute("aria-label", `${field} minimum`);
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.className = "gallery-range-input";
    maxInput.placeholder = "Max";
    maxInput.setAttribute("aria-label", `${field} maximum`);
    const labelForRange = (text: string): HTMLSpanElement => {
      const span = document.createElement("span");
      span.className = "gallery-range-label";
      span.textContent = text;
      return span;
    };
    group.append(
      labelForRange("$"),
      minInput,
      labelForRange("\u2013"),
      maxInput,
    );
    const readRange = (): void => {
      const min = parseNumberInput(minInput.value);
      const max = parseNumberInput(maxInput.value);
      rangeStates.set(field, { min, max });
      void runSearch();
    };
    minInput.addEventListener("input", readRange);
    maxInput.addEventListener("input", readRange);
    rangeSection.append(group);
  }

  // --- geo filter (docs/guides/facets.md#geo-facets): lat/lon/radius
  // inputs plus a sort-by-distance toggle, active only once all three
  // numeric inputs have a value (mirroring the range facet's "both ends
  // optional but a filter only applies once meaningful" behavior, except
  // a geo filter needs all three to mean anything at all).
  let geoState: {
    lat: number | undefined;
    lon: number | undefined;
    radiusKm: number | undefined;
  } = {
    lat: geoLatPreset,
    lon: geoLonPreset,
    radiusKm: geoRadiusPreset,
  };
  let sortByDistanceEnabled = sortByDistancePreset;
  let geoMapFigure: HTMLElement | undefined;
  if (geoFacetField) {
    const group = document.createElement("fieldset");
    group.className = "gallery-facet-group gallery-geo-facet";
    const legend = document.createElement("legend");
    legend.textContent = `${geoFacetField} (near me)`;
    group.append(legend);

    const latInput = document.createElement("input");
    latInput.type = "number";
    latInput.step = "any";
    latInput.className = "gallery-range-input";
    latInput.placeholder = "Latitude";
    latInput.setAttribute("aria-label", `${geoFacetField} latitude`);
    if (geoLatPreset !== undefined) latInput.value = String(geoLatPreset);
    const lonInput = document.createElement("input");
    lonInput.type = "number";
    lonInput.step = "any";
    lonInput.className = "gallery-range-input";
    lonInput.placeholder = "Longitude";
    lonInput.setAttribute("aria-label", `${geoFacetField} longitude`);
    if (geoLonPreset !== undefined) lonInput.value = String(geoLonPreset);
    const radiusInput = document.createElement("input");
    radiusInput.type = "number";
    radiusInput.min = "0";
    radiusInput.className = "gallery-range-input";
    radiusInput.placeholder = "Radius (km)";
    radiusInput.setAttribute(
      "aria-label",
      `${geoFacetField} radius in kilometers`,
    );
    if (geoRadiusPreset !== undefined) {
      radiusInput.value = String(geoRadiusPreset);
    }
    group.append(latInput, lonInput, radiusInput);

    const locateButton = document.createElement("button");
    locateButton.type = "button";
    locateButton.className = "gallery-geo-locate";
    locateButton.textContent = "Use my location";
    const locateStatus = document.createElement("span");
    locateStatus.className = "gallery-geo-locate-status";
    locateStatus.setAttribute("role", "status");
    locateButton.addEventListener("click", () => {
      if (!("geolocation" in navigator)) {
        locateStatus.textContent =
          "Geolocation isn't available in this browser.";
        return;
      }
      locateStatus.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          latInput.value = position.coords.latitude.toFixed(4);
          lonInput.value = position.coords.longitude.toFixed(4);
          if (!radiusInput.value) radiusInput.value = "500";
          locateStatus.textContent = "";
          readGeo();
        },
        (error) => {
          locateStatus.textContent =
            error.code === error.PERMISSION_DENIED
              ? "Location access denied — enter coordinates manually."
              : "Couldn't get your location — enter coordinates manually.";
        },
        { timeout: 10_000 },
      );
    });
    group.append(locateButton, locateStatus);

    const sortLabel = document.createElement("label");
    sortLabel.className = "gallery-toggle";
    const sortCheckbox = document.createElement("input");
    sortCheckbox.type = "checkbox";
    sortCheckbox.checked = sortByDistancePreset;
    sortCheckbox.setAttribute("aria-label", "Sort by distance");
    sortCheckbox.addEventListener("change", () => {
      sortByDistanceEnabled = sortCheckbox.checked;
      void runSearch();
    });
    sortLabel.append(
      sortCheckbox,
      document.createTextNode(" Sort by distance"),
    );
    group.append(sortLabel);

    const readGeo = (): void => {
      geoState = {
        lat: parseNumberInput(latInput.value),
        lon: parseNumberInput(lonInput.value),
        radiusKm: parseNumberInput(radiusInput.value),
      };
      void runSearch();
    };
    latInput.addEventListener("input", readGeo);
    lonInput.addEventListener("input", readGeo);
    radiusInput.addEventListener("input", readGeo);

    const mapFigure = document.createElement("figure");
    mapFigure.className = "gallery-geo-map-figure";
    mapFigure.hidden = true;
    group.append(mapFigure);
    geoMapFigure = mapFigure;

    geoSection.append(group);
  }

  // Rebuilds the geo minimap from the current origin/radius plus whichever
  // of the just-fetched hits carry a parseable geoFacetField value in their
  // stored fields -- a no-op when there's no geo facet configured at all.
  function updateGeoMap(hits: Hit[]): void {
    if (!geoFacetField || !geoMapFigure) return;
    const origin =
      geoState.lat !== undefined && geoState.lon !== undefined
        ? { lat: geoState.lat, lon: geoState.lon }
        : undefined;
    const seen = new Set<string>();
    const points: Array<{ lat: number; lon: number; label: string }> = [];
    for (const hit of hits) {
      const point = parseStoredPoint(hit.fields[geoFacetField]);
      if (!point) continue;
      const key = `${point.lat},${point.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ ...point, label: hit.fields.title ?? hit.url });
    }
    const svg = renderGeoMapSvg(origin, geoState.radiusKm, points);
    if (!svg) {
      geoMapFigure.hidden = true;
      geoMapFigure.replaceChildren();
      return;
    }
    const caption = document.createElement("figcaption");
    caption.className = "gallery-geo-map-caption";
    // Several results sharing one pickup point collapse to a single dot
    // (docs/guides/facets.md#geo-facets) -- called out explicitly so that
    // doesn't read as the map only having plotted one of several results.
    const locationNote =
      points.length === 1 && hits.length > 1
        ? ` All ${hits.length} shown results share this one location.`
        : "";
    caption.textContent = `Schematic plot (straight-line distance, not real coastlines).${locationNote}`;
    geoMapFigure.hidden = false;
    geoMapFigure.replaceChildren(svg, caption);
  }

  // --- exact-match filter on a stored (not faceted) field
  // (docs/guides/facets.md#exact-match-on-stored-fields): a plain text
  // input per field, active only once it holds the field's exact stored
  // value -- unlike the checkbox facets above, there's no discrete value
  // list to offer, so a partial/typo'd value simply matches nothing.
  const exactStates = new Map<string, string>(exactValuePresets);
  for (const field of exactFields) {
    const group = document.createElement("fieldset");
    group.className = "gallery-facet-group gallery-exact-facet";
    const legend = document.createElement("legend");
    legend.textContent = `${field} (exact match)`;
    group.append(legend);
    const exactInput = document.createElement("input");
    exactInput.type = "text";
    exactInput.className = "gallery-range-input";
    exactInput.placeholder = `Exact ${field}`;
    exactInput.setAttribute("aria-label", `${field} exact match`);
    const presetValue = exactValuePresets.get(field);
    if (presetValue !== undefined) exactInput.value = presetValue;
    exactInput.addEventListener("input", () => {
      const value = exactInput.value.trim();
      if (value) exactStates.set(field, value);
      else exactStates.delete(field);
      void runSearch();
    });
    group.append(exactInput);
    exactSection.append(group);
  }

  root.replaceChildren(controls, body);

  // field -> set of selected values, OR'd within a field (docs/guides/facets.md#filtering)
  const selectedFilters = new Map<string, Set<string>>();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runSearch(), 150);
  });

  function currentFilters():
    | Record<string, string | string[] | RangeFilter | GeoFilter>
    | undefined {
    const out: Record<string, string | string[] | RangeFilter | GeoFilter> = {};
    for (const [field, values] of selectedFilters) {
      if (values.size > 0) out[field] = [...values];
    }
    for (const field of rangeFacetFields) {
      const range = rangeStates.get(field);
      if (!range) continue;
      if (range.min === undefined && range.max === undefined) continue;
      const filter: RangeFilter = {};
      if (range.min !== undefined) filter.min = range.min;
      if (range.max !== undefined) filter.max = range.max;
      out[field] = filter;
    }
    if (
      geoFacetField &&
      geoState.lat !== undefined &&
      geoState.lon !== undefined &&
      geoState.radiusKm !== undefined
    ) {
      out[geoFacetField] = {
        lat: geoState.lat,
        lon: geoState.lon,
        radiusKm: geoState.radiusKm,
      };
    }
    for (const [field, value] of exactStates) {
      out[field] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }

  function renderFacets(facets: SearchResult["facets"]): void {
    checkboxSection.replaceChildren();
    if (!facets) return;
    for (const field of facetFields) {
      const result = facets[field];
      if (!result) continue;
      const group = document.createElement("fieldset");
      group.className = "gallery-facet-group";
      const legend = document.createElement("legend");
      legend.textContent = field;
      group.append(legend);
      for (const value of result.values) {
        const label = document.createElement("label");
        label.className = "gallery-facet-value";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = value.selected;
        checkbox.disabled = value.count === 0 && !value.selected;
        checkbox.addEventListener("change", () => {
          const set = selectedFilters.get(field) ?? new Set<string>();
          if (checkbox.checked) set.add(value.value);
          else set.delete(value.value);
          selectedFilters.set(field, set);
          void runSearch();
        });
        label.append(
          checkbox,
          document.createTextNode(` ${value.value} (${value.count})`),
        );
        group.append(label);
      }
      checkboxSection.append(group);
    }
  }

  function appendFieldText(
    parent: HTMLElement,
    span: HighlightSpan[] | undefined,
    fallback: string,
  ): void {
    if (!span || span.length === 0) {
      parent.textContent = fallback;
      return;
    }
    for (const part of span) {
      if (part.isMatch) {
        const mark = document.createElement("mark");
        mark.className = "gallery-hit-highlight";
        mark.textContent = part.text;
        parent.append(mark);
      } else {
        parent.append(document.createTextNode(part.text));
      }
    }
  }

  function renderResults(
    result: SearchResult,
    expandedOnlyIds: Set<number>,
    expansionLabel: string,
  ): void {
    resultsPane.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "gallery-results-summary";
    // docs/reference/client-api.md: this text is already
    // visible to sighted users, so making it an aria-live region
    // announces the same result-count change to screen reader users
    // too, rather than needing a separate hidden element.
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.textContent = `${result.totalHits} result${result.totalHits === 1 ? "" : "s"}`;
    resultsPane.append(summary);

    if (result.hits.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "No results.";
      resultsPane.append(empty);
      if (result.didYouMean?.length) {
        const suggest = document.createElement("p");
        suggest.className = "gallery-did-you-mean";
        suggest.textContent = `Did you mean: ${result.didYouMean.join(", ")}?`;
        resultsPane.append(suggest);
      }
      return;
    }

    const list = document.createElement("ul");
    list.className = "gallery-hit-list";
    for (const hit of result.hits) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = new URL(hit.url.replace(/^\//, ""), siteRoot).href;
      const title = document.createElement("div");
      title.className = "gallery-hit-title";
      appendFieldText(
        title,
        hit.highlights?.title,
        hit.fields.title ?? hit.url,
      );
      if (hit.pinned) {
        const badge = document.createElement("span");
        badge.className = "gallery-badge";
        badge.textContent = "Pinned";
        title.append(" ", badge);
      }
      if (expandedOnlyIds.has(hit.id)) {
        const badge = document.createElement("span");
        badge.className = "gallery-badge gallery-badge-expansion";
        badge.textContent = expansionLabel;
        title.append(" ", badge);
      }
      if (hit.distanceKm !== undefined) {
        const badge = document.createElement("span");
        badge.className = "gallery-badge gallery-badge-distance";
        badge.textContent = `${hit.distanceKm.toFixed(0)} km away`;
        title.append(" ", badge);
      }
      const excerpt = document.createElement("div");
      excerpt.className = "gallery-hit-excerpt";
      appendFieldText(
        excerpt,
        hit.highlights?.excerpt,
        hit.fields.excerpt ?? "",
      );
      a.append(title, excerpt);
      li.append(a);
      list.append(li);
    }
    resultsPane.append(list);
  }

  function renderHint(message: string): void {
    resultsPane.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "gallery-results-summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.textContent = "0 results";
    resultsPane.append(summary);
    const hint = document.createElement("p");
    hint.className = "gallery-empty";
    hint.textContent = message;
    resultsPane.append(hint);
  }

  function renderSearchError(): void {
    resultsPane.replaceChildren();
    const message = document.createElement("p");
    message.className = "gallery-error";
    message.setAttribute("role", "alert");
    message.textContent =
      "This example could not load. Try refreshing the page.";
    resultsPane.append(message);
  }

  let latestQueryId = 0;
  async function runSearch(): Promise<void> {
    const queryId = ++latestQueryId;
    const query = input.value.trim() || (browseOnly ? "" : defaultQuery);
    const filters = currentFilters();
    if (!query && !browseOnly) return;
    root.setAttribute("aria-busy", "true");
    try {
      if (!query && browseOnly) {
        // A no-query search isn't a supported API (search() short-circuits on
        // zero terms), but the facet-only surface is: render the filter panel
        // via client.facetValues and wait for a query to show hits
        // (docs/reference/client-api.md#facet-only-queries).
        const facetResults: SearchResult["facets"] = {};
        for (const field of facetFields) {
          const result = await client.facetValues?.(field, {
            ...(filters ? { filters } : {}),
          });
          if (result) facetResults[field] = result;
        }
        if (queryId !== latestQueryId) return;
        renderFacets(facetResults);
        renderHint("Type a query to see matching products.");
        updateGeoMap([]);
        return;
      }

      const options: SearchOptions = {
        limit: RESULT_LIMIT,
        facets: facetFields,
        fuzzy: fuzzyEnabled,
        synonyms: synonymsEnabled,
        operator: selectedOperator,
        ...(filters ? { filters } : {}),
        ...(selectedLanguage ? { language: selectedLanguage } : {}),
        ...(showHighlight ? { highlight: true } : {}),
        ...(fuzzyEnabled && fuzzyWeightKnob
          ? { fuzzyWeight: Number(fuzzyWeightKnob.value) }
          : {}),
        ...(synonymsEnabled && synonymWeightKnob
          ? { synonymWeight: Number(synonymWeightKnob.value) }
          : {}),
        ...(sortByDistanceEnabled ? { sortByDistance: true } : {}),
      };
      if (activeFieldBoosts.size > 0 || activeTermBoosts.size > 0) {
        options.boosts = {
          ...(activeFieldBoosts.size > 0
            ? { fields: Object.fromEntries(activeFieldBoosts) }
            : {}),
          ...(activeTermBoosts.size > 0
            ? { terms: Object.fromEntries(activeTermBoosts) }
            : {}),
        };
      }

      const result = await client.search(query, options);
      if (queryId !== latestQueryId) return; // a newer request already superseded this one

      // Only the toggles' own contribution is worth labeling -- if neither
      // is on there's nothing expansion-only to diff against, so skip the
      // extra baseline round trip in the common (non-demo-toggle) case.
      let expandedOnlyIds = new Set<number>();
      if (fuzzyEnabled || synonymsEnabled) {
        const baseline = await client.search(query, {
          ...options,
          fuzzy: false,
          synonyms: false,
        });
        if (queryId !== latestQueryId) return;
        const baselineIds = new Set(baseline.hits.map((h) => h.id));
        expandedOnlyIds = new Set(
          result.hits.map((h) => h.id).filter((id) => !baselineIds.has(id)),
        );
      }
      const expansionLabel =
        fuzzyEnabled && synonymsEnabled
          ? "Expanded match"
          : fuzzyEnabled
            ? "Fuzzy match"
            : "Synonym match";

      renderFacets(result.facets);
      renderResults(result, expandedOnlyIds, expansionLabel);
      updateGeoMap(result.hits);
    } catch (error: unknown) {
      if (queryId === latestQueryId) renderSearchError();
      console.error("Failed to search showcase example", error);
    } finally {
      if (queryId === latestQueryId) root.setAttribute("aria-busy", "false");
    }
  }

  await runSearch();
}
