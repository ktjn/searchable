import { parse } from "node-html-parser";

export interface PinDeclaration {
  phrase: string;
  mode: "exact" | "contains";
  priority: number;
  exclusive: boolean;
}

export interface ExtractedDocument {
  title: string;
  language: string;
  body: string;
  excerpt: string;
  url: string;
  noindex: boolean;
  boost: number;
  /** Facet field name -> distinct values declared via csf-facet-<field> (docs/15-cms-meta-tag-control.md). */
  facets: Record<string, string[]>;
  pins: PinDeclaration[];
}

const FACET_TAG_PREFIX = "csf-facet-";

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
 * csf-* meta-tag control surface (docs/15-cms-meta-tag-control.md):
 * title/body/language/excerpt/canonical/noindex/boost plus facet
 * values (csf-facet-<field>) and pin declarations (csf-pin*, see
 * docs/16-term-to-page-pinning.md).
 */
export function extractDocument(
  html: string,
  sourceUrl: string,
  defaultLanguage = "en",
): ExtractedDocument {
  const root = parse(html);

  const noindex = root.querySelector('meta[name="csf-noindex"]') !== null;

  const title = collapseWhitespace(
    root.querySelector("title")?.structuredText ?? "",
  );

  const language =
    root.querySelector("html")?.getAttribute("lang")?.trim() || defaultLanguage;

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

  const facets: Record<string, string[]> = {};
  for (const meta of root.querySelectorAll("meta")) {
    const name = meta.getAttribute("name") ?? "";
    if (!name.startsWith(FACET_TAG_PREFIX)) continue;
    const field = name.slice(FACET_TAG_PREFIX.length);
    const value = meta.getAttribute("content")?.trim();
    if (!field || !value) continue;
    const values = facets[field] ?? [];
    if (!values.includes(value)) values.push(value);
    facets[field] = values;
  }

  const pinPhrases = root
    .querySelectorAll('meta[name="csf-pin"]')
    .map((el) => el.getAttribute("content")?.trim())
    .filter((v): v is string => Boolean(v));

  const pinModeAttr = root
    .querySelector('meta[name="csf-pin-mode"]')
    ?.getAttribute("content")
    ?.trim();
  const pinMode: "exact" | "contains" =
    pinModeAttr === "contains" ? "contains" : "exact";

  const pinPriorityAttr = root
    .querySelector('meta[name="csf-pin-priority"]')
    ?.getAttribute("content");
  const parsedPriority = pinPriorityAttr
    ? Number.parseFloat(pinPriorityAttr)
    : Number.NaN;
  const pinPriority = Number.isFinite(parsedPriority) ? parsedPriority : 0;

  // Presence-based, like csf-noindex above: the tag's content isn't
  // interpreted, only whether the tag exists on the page at all.
  const pinExclusive =
    root.querySelector('meta[name="csf-pin-exclusive"]') !== null;

  const pins: PinDeclaration[] = pinPhrases.map((phrase) => ({
    phrase,
    mode: pinMode,
    priority: pinPriority,
    exclusive: pinExclusive,
  }));

  return { title, language, body, excerpt, url, noindex, boost, facets, pins };
}
