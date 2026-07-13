import { expect, test } from "vitest";
import { renderHubPage } from "../build-gallery-index.js";
import type { QuickExample } from "../quick-examples.js";
import {
  QUICK_EXAMPLES,
  renderExampleCode,
  renderRuntimeAttributes,
} from "../quick-examples.js";

test("contains one unique example for every approved behavior", () => {
  expect(QUICK_EXAMPLES.map((example) => example.id)).toEqual([
    "basic",
    "fuzzy",
    "facets",
    "synonyms",
    "pinning",
    "internationalization",
  ]);
});

test("links fuzzy matching to its canonical guide heading", () => {
  expect(
    QUICK_EXAMPLES.find((example) => example.id === "fuzzy")?.guideHref,
  ).toBe("../docs/guides/ranking-and-boosts.html#prefix-and-fuzzy-matching");
});

test("displayed source and runtime attributes derive from one definition", () => {
  for (const example of QUICK_EXAMPLES) {
    const attributes = renderRuntimeAttributes(example);
    const code = renderExampleCode(example);
    expect(attributes).toContain(`data-index-path="${example.indexPath}"`);
    expect(code).toContain(example.indexPath);
    expect(code).toContain(JSON.stringify(example.initialQuery));
  }
});

test("renders every optional behavior in attributes and displayed source", () => {
  const byId = new Map(QUICK_EXAMPLES.map((example) => [example.id, example]));

  expect(renderRuntimeAttributes(byId.get("facets") as QuickExample)).toContain(
    'data-facets="category"',
  );
  expect(renderExampleCode(byId.get("facets") as QuickExample)).toContain(
    'facets: ["category"]',
  );
  expect(renderRuntimeAttributes(byId.get("fuzzy") as QuickExample)).toContain(
    'data-fuzzy-toggle="true"',
  );
  expect(renderExampleCode(byId.get("fuzzy") as QuickExample)).toContain(
    "fuzzy: true",
  );
  expect(
    renderRuntimeAttributes(byId.get("synonyms") as QuickExample),
  ).toContain('data-synonyms-toggle="true"');
  expect(renderExampleCode(byId.get("synonyms") as QuickExample)).toContain(
    "synonyms: true",
  );
  expect(
    renderRuntimeAttributes(byId.get("internationalization") as QuickExample),
  ).toContain('data-languages="en,de"');
  expect(
    renderExampleCode(byId.get("internationalization") as QuickExample),
  ).toContain('language: "en"');
});

test("escapes runtime attribute values", () => {
  const example: QuickExample = {
    id: "escape",
    title: "Escape",
    description: "Escape attribute values.",
    guideHref: "../docs/index.html",
    indexPath: 'gallery/a&b"<manifest.json',
    initialQuery: 'desk & chair "sale"',
    facets: ['kind&style"'],
  };

  expect(renderRuntimeAttributes(example)).toContain(
    'data-index-path="gallery/a&amp;b&quot;&lt;manifest.json"',
  );
  expect(renderRuntimeAttributes(example)).toContain(
    'data-default-query="desk &amp; chair &quot;sale&quot;"',
  );
  expect(renderRuntimeAttributes(example)).toContain(
    'data-facets="kind&amp;style&quot;"',
  );
});

test("renders six interactive cards and four complete demo links", () => {
  const html = renderHubPage();

  expect(html.match(/data-gallery-root/g)).toHaveLength(6);
  expect(html.match(/<article class="quick-example-card"/g)).toHaveLength(6);
  expect(html.match(/<details class="example-source">/g)).toHaveLength(6);
  expect(
    html.match(/<ul class="gallery-demo-list">[\s\S]*?<\/ul>/)?.[0],
  ).toMatch(/(?:<li>[\s\S]*?){4}/);
  expect(html.match(/gallery-widget\.js/g)).toHaveLength(1);
  expect(html).toContain('<span class="hljs-keyword">const</span>');
  expect(html).toContain('href="../docs/getting-started/first-search.html"');
});
