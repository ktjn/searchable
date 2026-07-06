/**
 * Loaded on every showcase page via <script type="module">. Not
 * bundled — plain TypeScript compiled to plain ES modules (see
 * ../tsconfig.widget.json) — this glue code has nothing to bundle, just
 * a dynamic import of the already-built @csf/client from a path
 * computed at runtime.
 *
 * `import.meta.url` (not the page's own location) is the anchor for
 * every site-root-relative path here — this file is always deployed as
 * a single copy at the site root (dist/search-widget.js), so its own
 * URL is a stable reference point regardless of which page loaded it
 * or how deep that page is nested. This matters because a relative
 * dynamic `import()` specifier resolves against *this module's* URL,
 * not the loading page's URL — using a page-depth-relative prefix here
 * (as an earlier version of this file did) breaks for every page except
 * ones at the same depth as this file, since the import would resolve
 * relative to search-widget.js's fixed location either way.
 */

interface Hit {
  id: number;
  score: number;
  url: string;
  fields: Record<string, string>;
}

interface SearchClientLike {
  search(query: string, options?: { limit?: number }): Promise<{ hits: Hit[] }>;
}

const siteRoot = new URL(".", import.meta.url);

const root = document.querySelector<HTMLDivElement>("[data-search-root]");
if (root) {
  void initSearch(root);
}

async function initSearch(root: HTMLDivElement): Promise<void> {
  const { SearchClient } = await import(
    new URL("assets/index.js", siteRoot).href
  );

  const client: SearchClientLike = new SearchClient({
    indexUrl: new URL("search-index/manifest.json", siteRoot).href,
    worker: true,
    workerUrl: new URL("assets/worker.js", siteRoot),
  });

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search these docs…";
  input.className = "csf-search-input";
  input.setAttribute("aria-label", "Search these docs");
  input.setAttribute("aria-expanded", "false");

  const results = document.createElement("div");
  results.className = "csf-search-results";
  results.id = "csf-search-results";
  input.setAttribute("aria-controls", results.id);

  // Visually hidden (docs/08-modern-features.md#accessibility): the
  // dropdown itself already shows results sighted users can see
  // directly, so this exists purely to announce the same outcome to
  // screen reader users via aria-live, not to duplicate visible UI.
  const announcer = document.createElement("div");
  announcer.className = "csf-sr-only";
  announcer.setAttribute("role", "status");
  announcer.setAttribute("aria-live", "polite");

  root.append(input, results, announcer);

  function setOpen(open: boolean): void {
    results.classList.toggle("is-open", open);
    input.setAttribute("aria-expanded", String(open));
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let latestQueryId = 0;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (!query) {
      setOpen(false);
      results.replaceChildren();
      announcer.textContent = "";
      return;
    }
    debounceTimer = setTimeout(() => runSearch(query), 150);
  });

  input.addEventListener("focus", () => {
    if (results.childElementCount > 0) setOpen(true);
  });

  document.addEventListener("click", (event) => {
    if (!root.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  async function runSearch(query: string): Promise<void> {
    const queryId = ++latestQueryId;
    const { hits } = await client.search(query, { limit: 8 });
    if (queryId !== latestQueryId) return; // a newer keystroke already superseded this one

    results.replaceChildren();
    if (hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "csf-empty";
      empty.textContent = `No results for "${query}".`;
      results.append(empty);
      announcer.textContent = `No results for "${query}".`;
    } else {
      const list = document.createElement("ul");
      for (const hit of hits) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = new URL(hit.url.replace(/^\//, ""), siteRoot).href;
        const title = document.createElement("div");
        title.className = "csf-result-title";
        title.textContent = hit.fields.title ?? hit.url;
        const excerpt = document.createElement("div");
        excerpt.className = "csf-result-excerpt";
        excerpt.textContent = hit.fields.excerpt ?? "";
        a.append(title, excerpt);
        li.append(a);
        list.append(li);
      }
      results.append(list);
      announcer.textContent = `${hits.length} result${hits.length === 1 ? "" : "s"} for "${query}".`;
    }
    setOpen(true);
  }
}
