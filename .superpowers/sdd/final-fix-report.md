# Final review fix report

## Scope

Addressed the complete final-review findings on base `784ae69`:

- made `pnpm docs:check` the locally reproducible Pages gate, including the full Playwright suite;
- installed Chromium before that gate in the Pages build job and kept upload/deploy after it;
- rejected root-absolute HTML `href`/`src` references without applying that rule to search-index document data;
- restricted navigation sources to the six approved documentation roots and rejected duplicate visible titles;
- linked the docs header and README to the guided feature gallery;
- added skip navigation, main targets, focus visibility, and sticky-header anchor spacing;
- added stable search-control names and disabled autocomplete/spellcheck for docs and gallery search.

## RED evidence

1. Initial focused test wave:

   ```text
   pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts showcase/test/site-validation.test.ts showcase/test/gallery-shared.test.ts showcase/test/pages-workflow-policy.test.ts
   ```

   Result: expected failure, 7 failed / 27 passed. Failures covered the missing Pages gate policy, root-absolute reference rejection, approved source roots, duplicate visible titles, gallery header route, and accessible shell landmarks.

2. Normalized manifest escape:

   ```text
   pnpm exec vitest run --config showcase/vitest.config.ts showcase/test/docs-site.test.ts -t "rejects sources outside"
   ```

   Result: expected failure, 1 failed, because `docs/guides/../archive/a.md` was still accepted.

3. Search metadata regression proof (implementation temporarily reverted, generated widget rebuilt, then restored):

   ```text
   pnpm --filter showcase build:widget
   pnpm exec playwright test showcase/e2e-browser/showcase.spec.ts --grep "docs search has stable|loads with the default browse-all"
   ```

   Result: expected failure, 2 failed, both on missing `name` attributes (`docs-search` and `gallery-search`).

## GREEN and verification evidence

- Focused RED/GREEN unit wave: 4 files, 34/34 passed.
- Approved-root traversal regression: 1/1 passed.
- Final showcase unit suite:

  ```text
  pnpm exec vitest run --config showcase/vitest.config.ts
  ```

  Result: 5 files, 40/40 passed.

- Documentation build:

  ```text
  pnpm docs:build
  ```

  Result: exit 0; 26 curated docs pages plus README rendered, 27 pages indexed, all gallery indexes/pages built.

- Generated-site validator:

  ```text
  pnpm --filter showcase validate
  ```

  Result: exit 0; all local links, assets, and fragments resolved.

- Type checking:

  ```text
  pnpm typecheck
  ```

  Result: exit 0 for all package and showcase projects.

- Scoped Biome:

  ```text
  pnpm exec biome check .github/workflows/deploy-pages.yml README.md package.json showcase/docs-site.ts showcase/e2e-browser/showcase.spec.ts showcase/gallery-shared.ts showcase/site-validation.ts showcase/src/gallery-widget.ts showcase/src/search-widget.ts showcase/src/style.css showcase/test/docs-site.test.ts showcase/test/site-validation.test.ts showcase/test/gallery-shared.test.ts showcase/test/pages-workflow-policy.test.ts
  ```

  Result: exit 0, no fixes required after formatting three new test sections.

- Full Playwright:

  ```text
  pnpm exec playwright test
  ```

  Result: 54/54 passed on Chromium.

- Exact revised Pages/local gate:

  ```text
  pnpm docs:check
  ```

  Result: exit 0; artifact build and validation passed, showcase tests 40/40 passed, full Playwright 54/54 passed.

- Existing Windows baseline:

  ```text
  pnpm test
  ```

  Result: the approved baseline is unchanged: 543 passed, 2 skipped, and exactly 4 failed. The failures remain the English and German CRLF vocabulary fixtures plus the two slash-sensitive `consumer-fixture` worker/service-worker path assertions.

## Files changed

- `.github/workflows/deploy-pages.yml`
- `README.md`
- `package.json`
- `showcase/docs-site.ts`
- `showcase/e2e-browser/showcase.spec.ts`
- `showcase/gallery-shared.ts`
- `showcase/site-validation.ts`
- `showcase/src/gallery-widget.ts`
- `showcase/src/search-widget.ts`
- `showcase/src/style.css`
- `showcase/test/docs-site.test.ts`
- `showcase/test/gallery-shared.test.ts`
- `showcase/test/pages-workflow-policy.test.ts`
- `showcase/test/site-validation.test.ts`

## Self-review

- Confirmed the workflow installs Chromium before the one `pnpm docs:check` invocation and uploads only afterward; there is no separate workflow Playwright command.
- Confirmed HTML root-absolute references are rejected before filesystem resolution, while `/docs/current.html` in search-index document data remains accepted.
- Normalized manifest sources before checking the exact allowlist, preventing `..` traversal through an allowed prefix.
- Confirmed README remains the separately rendered home page rather than entering `DOC_SECTIONS`.
- Confirmed generated docs headers use `gallery/index.html`, and shared gallery shells retain their existing subpath-relative header link.
- Confirmed skip links become visible on focus and anchored headings compute an 80px scroll margin in Chromium.
- Preserved the custom generator, real generated indexes, runtime search behavior, and the four known Windows-only baseline failures.

## Concerns

- `pnpm docs:check` invokes `pnpm test:browser`, whose existing `pretest:browser` hook rebuilds packages and the showcase after the initial docs build. This is redundant build work but deliberately preserves the established browser command and still executes the browser suite only once in the Pages workflow.
- No functional concerns remain in the requested scope.
