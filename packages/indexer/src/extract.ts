import { parse } from "node-html-parser";

export interface ExtractedDocument {
  title: string;
  language: string;
  body: string;
  excerpt: string;
  url: string;
  noindex: boolean;
  boost: number;
}

const BOILERPLATE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Extracts indexable fields from one rendered HTML page, honoring the
 * csf-* meta-tag control surface (docs/15-cms-meta-tag-control.md) for
 * the subset relevant to indexing content (title/body/language/
 * excerpt/canonical/noindex/boost — facet/pin extraction land with the
 * roadmap phases that have a consumer for them).
 */
export function extractDocument(
  html: string,
  sourceUrl: string,
): ExtractedDocument {
  const root = parse(html);

  const noindex = root.querySelector('meta[name="csf-noindex"]') !== null;

  const title = collapseWhitespace(
    root.querySelector("title")?.structuredText ?? "",
  );

  const language =
    root.querySelector("html")?.getAttribute("lang")?.trim() || "en";

  const canonical = root
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  const url = canonical?.trim() || sourceUrl;

  const excerpt = collapseWhitespace(
    root.querySelector('meta[name="description"]')?.getAttribute("content") ??
      "",
  );

  const bodyRoot =
    root.querySelector("[data-csf-body]") ??
    root.querySelector("main") ??
    root.querySelector("body");

  for (const el of bodyRoot?.querySelectorAll(
    [...BOILERPLATE_SELECTORS, "[data-csf-ignore]"].join(","),
  ) ?? []) {
    el.remove();
  }

  const body = collapseWhitespace(bodyRoot?.structuredText ?? "");

  const boostAttr = root
    .querySelector('meta[name="csf-boost"]')
    ?.getAttribute("content");
  const parsedBoost = boostAttr ? Number.parseFloat(boostAttr) : Number.NaN;
  const boost =
    Number.isFinite(parsedBoost) && parsedBoost > 0 ? parsedBoost : 1.0;

  return { title, language, body, excerpt, url, noindex, boost };
}
