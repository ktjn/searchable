/**
 * Loaded on every Stage 2 feature-gallery demo page via
 * <script type="module"> (docs/19-github-pages-showcase.md#stage-2--feature-gallery-needs-phases-2-5).
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
 *        data-fuzzy-toggle="true">      (omit to hide the fuzzy on/off control)
 *   </div>
 *
 * Same import.meta.url-anchored site-root resolution as search-widget.ts
 * -- this script is deployed once at the site root regardless of how
 * deeply nested the page that loads it is.
 */

interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
  pinned?: boolean;
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

interface SearchOptions {
  limit?: number;
  filters?: Record<string, string | string[]>;
  facets?: string[];
  fuzzy?: boolean;
}

interface SearchClientLike {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
}

const siteRoot = new URL(".", import.meta.url);

const galleryRoots = document.querySelectorAll<HTMLDivElement>(
  "[data-gallery-root]",
);
for (let i = 0; i < galleryRoots.length; i++) {
  void initGallery(galleryRoots[i] as HTMLDivElement);
}

async function initGallery(root: HTMLDivElement): Promise<void> {
  const indexPath = root.dataset.indexPath;
  if (!indexPath) return;
  const defaultQuery = root.dataset.defaultQuery ?? "";
  const facetFields = (root.dataset.facets ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const showFuzzyToggle = root.dataset.fuzzyToggle === "true";

  const { SearchClient } = await import(
    new URL("assets/index.js", siteRoot).href
  );
  const client: SearchClientLike = new SearchClient({
    indexUrl: new URL(indexPath, siteRoot).href,
    worker: true,
    workerUrl: new URL("assets/worker.js", siteRoot),
  });

  const controls = document.createElement("div");
  controls.className = "gallery-controls";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "gallery-search-input";
  input.placeholder = "Search…";
  input.value = defaultQuery;
  input.setAttribute("aria-label", "Search this demo");
  controls.append(input);

  let fuzzyEnabled = false;
  if (showFuzzyToggle) {
    const label = document.createElement("label");
    label.className = "gallery-fuzzy-toggle";
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

  const body = document.createElement("div");
  body.className = "gallery-body";

  const facetsPane = document.createElement("div");
  facetsPane.className = "gallery-facets";
  body.append(facetsPane);

  const resultsPane = document.createElement("div");
  resultsPane.className = "gallery-results";
  body.append(resultsPane);

  root.append(controls, body);

  // field -> set of selected values, OR'd within a field (docs/06-faceted-search.md#filtering)
  const selectedFilters = new Map<string, Set<string>>();

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runSearch(), 150);
  });

  function currentFilters(): Record<string, string[]> | undefined {
    if (selectedFilters.size === 0) return undefined;
    const out: Record<string, string[]> = {};
    for (const [field, values] of selectedFilters) {
      if (values.size > 0) out[field] = [...values];
    }
    return Object.keys(out).length ? out : undefined;
  }

  function renderFacets(facets: SearchResult["facets"]): void {
    facetsPane.replaceChildren();
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
      facetsPane.append(group);
    }
  }

  function renderResults(result: SearchResult): void {
    resultsPane.replaceChildren();
    const summary = document.createElement("p");
    summary.className = "gallery-results-summary";
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
      title.textContent = hit.fields.title ?? hit.url;
      if (hit.pinned) {
        const badge = document.createElement("span");
        badge.className = "gallery-badge";
        badge.textContent = "Pinned";
        title.append(" ", badge);
      }
      const excerpt = document.createElement("div");
      excerpt.className = "gallery-hit-excerpt";
      excerpt.textContent = hit.fields.excerpt ?? "";
      a.append(title, excerpt);
      li.append(a);
      list.append(li);
    }
    resultsPane.append(list);
  }

  let latestQueryId = 0;
  async function runSearch(): Promise<void> {
    const queryId = ++latestQueryId;
    const query = input.value.trim() || defaultQuery;
    if (!query) return;
    const filters = currentFilters();
    const result = await client.search(query, {
      limit: 24,
      facets: facetFields,
      ...(filters ? { filters } : {}),
      fuzzy: fuzzyEnabled,
    });
    if (queryId !== latestQueryId) return; // a newer request already superseded this one
    renderFacets(result.facets);
    renderResults(result);
  }

  await runSearch();
}
