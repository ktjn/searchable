/**
 * Loaded on every showcase page via <script type="module">. Bundled and
 * content-hashed by Vite (../vite.widget.config.ts) rather than plain
 * `tsc`, so a redeploy that changes this file's compiled output gets a
 * new filename and forces browsers to fetch it instead of serving a
 * stale cached copy under the old, unchanged name -- the pages that
 * load it (docs-site.ts's renderSitePage) reference whichever hashed
 * filename ../vite-manifest.ts resolves for the "search-widget" entry
 * at build time, not a literal "search-widget.js".
 *
 * `import("@ktjn/searchable")` is a literal specifier so Vite can
 * resolve and code-split it at build time (a dynamic `new URL(...).href`
 * computed at runtime, as an earlier version of this file used, isn't
 * statically analyzable and can't be bundled) -- Vite pins that shared
 * dependency to a stable `assets/index.js` chunk (see
 * vite.widget.config.ts's `manualChunks`), so its own site-root-relative
 * fetch URL doesn't change just because this file's hash does.
 *
 * `import.meta.url` (not the page's own location) is still the anchor
 * for the site-root-relative data paths below (the search index isn't
 * part of Vite's module graph) — this file is always deployed as a
 * single copy at the site root, so its own URL is a stable reference
 * point regardless of which page loaded it or how deep that page is
 * nested. A relative fetch built from a page-depth-relative prefix (as
 * an even earlier version of this file did) breaks for every page
 * except ones at the same depth as this file, since resolution against
 * this module's own URL is what actually anchors it correctly either
 * way.
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
  const { SearchClient } = await import("@ktjn/searchable");

  const client: SearchClientLike = new SearchClient({
    indexUrl: new URL("search-index/manifest.json", siteRoot).href,
  });

  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search these docs…";
  input.className = "searchable-search-input";
  input.name = "docs-search";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search these docs");
  input.setAttribute("aria-expanded", "false");

  const results = document.createElement("div");
  results.className = "searchable-search-results";
  results.id = "searchable-search-results";
  input.setAttribute("aria-controls", results.id);

  // Visually hidden (docs/reference/client-api.md): the
  // dropdown itself already shows results sighted users can see
  // directly, so this exists purely to announce the same outcome to
  // screen reader users via aria-live, not to duplicate visible UI.
  const announcer = document.createElement("div");
  announcer.className = "searchable-sr-only";
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
      empty.className = "searchable-empty";
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
        title.className = "searchable-result-title";
        title.textContent = hit.fields.title ?? hit.url;
        const excerpt = document.createElement("div");
        excerpt.className = "searchable-result-excerpt";
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
