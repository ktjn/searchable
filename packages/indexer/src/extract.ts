import { detectLanguage, getRegisteredLanguageCodes } from "@csf/analysis";
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
  /** Range-facet field name -> single numeric value declared via csf-facet-range-<field> (docs/06-faceted-search.md). One value per doc, unlike terms facets. */
  rangeFacets: Record<string, number>;
  pins: PinDeclaration[];
}

const FACET_TAG_PREFIX = "csf-facet-";
const RANGE_FACET_TAG_PREFIX = "csf-facet-range-";

export interface CanonicalUrlOptions {
  /**
   * Restricts an absolute canonical URL to one of these exact origins
   * (scheme + host + port, e.g. `"https://example.com"`) — anything
   * else falls back to the document's own crawled `sourceUrl`, same as
   * a missing/invalid canonical tag. Off by default: with no allowlist
   * configured, any `http:`/`https:` origin is accepted (see
   * `SAFE_URL_PROTOCOLS` below) since most deployments have no fixed
   * production origin at index time (e.g. a preview/staging build).
   */
  allowedUrlOrigins?: string[];
  /**
   * Base URL used to resolve a root-relative (`"/products/widget"`) or
   * otherwise relative canonical href into an absolute URL before
   * protocol/origin checks run. Without this, only already-absolute
   * `http:`/`https:` canonical URLs and bare root-relative paths are
   * accepted — a canonical href that's relative to the *current* page
   * (not root-relative) has no way to resolve to anything meaningful
   * without knowing that page's own URL, so it's rejected (falls back
   * to `sourceUrl`) rather than guessed at.
   */
  baseUrl?: string;
}

/**
 * Schemes a canonical URL is allowed to resolve to (docs/15-cms-meta-tag-control.md#canonical-url):
 * `javascript:`, `data:`, and other executable/non-web schemes are
 * rejected outright, since this value flows through to `Hit.url`, which
 * a consuming app may render directly into a link — untrusted/malformed
 * rendered HTML producing one of those schemes would otherwise be a
 * real XSS footgun handed straight to every consumer.
 */
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validates a `<link rel="canonical">` href before trusting it as a
 * document's `url` (docs/15-cms-meta-tag-control.md#canonical-url) —
 * malformed, non-web-scheme, or (when `allowedUrlOrigins` is set)
 * off-allowlist values fall back to `sourceUrl`, exactly as if no
 * canonical tag were present at all, rather than either throwing (one
 * bad page souring an entire build) or passing the raw value through
 * unchecked (the security footgun this exists to close).
 */
function sanitizeCanonicalUrl(
  canonical: string | undefined,
  sourceUrl: string,
  options: CanonicalUrlOptions,
): string {
  if (!canonical) return sourceUrl;

  // Root-relative paths ("/products/widget") have no scheme to exploit
  // and need no base to resolve -- accepted as-is, matching how a real
  // browser treats <link rel="canonical" href="/foo">. Protocol-relative
  // ("//evil.com/foo") is deliberately excluded from this fast path (its
  // second character is also "/") so it always goes through full URL
  // resolution below instead of being trusted blind.
  if (canonical.startsWith("/") && !canonical.startsWith("//")) {
    return canonical;
  }

  let parsed: URL;
  try {
    parsed = new URL(canonical, options.baseUrl);
  } catch {
    console.warn(
      `[csf-indexer] canonical URL "${canonical}" for ${sourceUrl} is malformed or relative with no baseUrl configured -- ignoring, indexing with ${sourceUrl} instead. See docs/15-cms-meta-tag-control.md#canonical-url.`,
    );
    return sourceUrl;
  }

  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
    console.warn(
      `[csf-indexer] canonical URL "${canonical}" for ${sourceUrl} uses a disallowed protocol (${parsed.protocol}) -- ignoring, indexing with ${sourceUrl} instead.`,
    );
    return sourceUrl;
  }

  if (
    options.allowedUrlOrigins &&
    !options.allowedUrlOrigins.includes(parsed.origin)
  ) {
    console.warn(
      `[csf-indexer] canonical URL "${canonical}" for ${sourceUrl} resolves to an origin (${parsed.origin}) not in allowedUrlOrigins -- ignoring, indexing with ${sourceUrl} instead.`,
    );
    return sourceUrl;
  }

  // `parsed.href`, not the raw `canonical` string: this is the point at
  // which a protocol-relative href (accepted here only because `baseUrl`
  // resolved it to a real origin) needs to become the actual absolute
  // URL, not the still-schemeless original.
  return parsed.href;
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
 * csf-* meta-tag control surface (docs/15-cms-meta-tag-control.md):
 * title/body/language/excerpt/canonical/noindex/boost plus facet
 * values (csf-facet-<field>) and pin declarations (csf-pin*, see
 * docs/16-term-to-page-pinning.md).
 */
export function extractDocument(
  html: string,
  sourceUrl: string,
  defaultLanguage = "en",
  canonicalUrlOptions: CanonicalUrlOptions = {},
): ExtractedDocument {
  const root = parse(html);

  const noindex = root.querySelector('meta[name="csf-noindex"]') !== null;

  const title = collapseWhitespace(
    root.querySelector("title")?.structuredText ?? "",
  );

  const declaredLanguage = root
    .querySelector("html")
    ?.getAttribute("lang")
    ?.trim();

  const canonical = root
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href")
    ?.trim();
  const url = sanitizeCanonicalUrl(canonical, sourceUrl, canonicalUrlOptions);

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

  // Explicit <html lang> always wins; detectLanguage() is only a
  // fallback for pages that declare none (docs/03-tokenization-i18n.md,
  // docs/09-roadmap.md's "Auto language detection accuracy" open
  // question) -- a deterministic, zero-bundled-model heuristic, not a
  // substitute for authoring real language metadata. Falls back to
  // defaultLanguage when detection itself has no confident signal
  // (e.g. too little text, or a language with no detection heuristic),
  // exactly the prior behavior for an undeclared page.
  const language =
    declaredLanguage ||
    detectLanguage(`${title} ${body}`, getRegisteredLanguageCodes()) ||
    defaultLanguage;

  const boostAttr = root
    .querySelector('meta[name="csf-boost"]')
    ?.getAttribute("content");
  const parsedBoost = boostAttr ? Number.parseFloat(boostAttr) : Number.NaN;
  const boost =
    Number.isFinite(parsedBoost) && parsedBoost > 0 ? parsedBoost : 1.0;

  const facets: Record<string, string[]> = {};
  const rangeFacets: Record<string, number> = {};
  for (const meta of root.querySelectorAll("meta")) {
    const name = meta.getAttribute("name") ?? "";
    // Checked first: csf-facet-range-<field> also starts with the plain
    // csf-facet- prefix below, so it would otherwise be misparsed as a
    // terms facet field literally named "range-<field>".
    if (name.startsWith(RANGE_FACET_TAG_PREFIX)) {
      const field = name.slice(RANGE_FACET_TAG_PREFIX.length);
      const raw = meta.getAttribute("content")?.trim();
      const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
      // First declared value wins; a page authoring the same range
      // field twice is almost certainly a mistake, not intentional.
      if (field && Number.isFinite(parsed) && !(field in rangeFacets)) {
        rangeFacets[field] = parsed;
      }
      continue;
    }
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

  return {
    title,
    language,
    body,
    excerpt,
    url,
    noindex,
    boost,
    facets,
    rangeFacets,
    pins,
  };
}
