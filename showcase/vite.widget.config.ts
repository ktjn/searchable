import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Bundles the two site-wide glue scripts (search-widget.ts,
 * gallery-widget.ts) with content-hashed output filenames, so a
 * redeployed site forces browsers to fetch the new script instead of
 * serving a stale cached copy under the old, unchanged filename --
 * the actual bug behind a visitor not seeing a just-shipped change
 * (docs/reference/client-api.md's page and every gallery demo page
 * load one of these two scripts via <script type="module">).
 *
 * `@ktjn/searchable` is pinned to a single chunk named "index" so it
 * keeps landing at the same site-root-relative path,
 * `assets/index.js`, that build-gallery*.ts and the widgets'
 * `siteRoot`-anchored asset resolution have always used --
 * showcase/e2e-browser/showcase.spec.ts also intercepts that exact
 * route to simulate a slow client load, so keeping the path stable
 * avoids rewriting that test alongside an unrelated caching fix. Only
 * the two *entry* files (the ones this repo's own code changes on
 * every push) need hashing to solve the caching problem; the vendor
 * chunk still gets a fresh fetch whenever its own content changes,
 * same as any other unhashed static asset under GitHub Pages' several-
 * minute cache lifetime.
 *
 * Must run before build-docs.ts/build-gallery*.ts (see this package's
 * "build" script) -- those scripts read this build's
 * dist/.vite/manifest.json (via vite-manifest.ts) to learn each
 * entry's real hashed filename before rendering any HTML that
 * references it. `emptyOutDir: true` makes this the pipeline's actual
 * first step, replacing build-docs.ts's own former responsibility for
 * starting from a clean dist/.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    manifest: true,
    target: "es2022",
    rollupOptions: {
      input: {
        "search-widget": resolve(__dirname, "src/search-widget.ts"),
        "gallery-widget": resolve(__dirname, "src/gallery-widget.ts"),
      },
      output: {
        entryFileNames: "[name]-[hash].js",
        chunkFileNames: (chunkInfo) =>
          chunkInfo.name === "index"
            ? "assets/index.js"
            : "assets/[name]-[hash].js",
        manualChunks(id) {
          if (id.includes("/packages/searchable/")) {
            return "index";
          }
        },
      },
    },
  },
});
