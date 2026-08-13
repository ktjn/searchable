import type { Manifest } from "@ktjn/searchable-format";

/**
 * Thrown when a fetched manifest fails structural validation
 * (REVIEW.md#5) — surfaced clearly at load time instead of failing
 * deep inside query execution against `undefined` fields.
 */
export class InvalidManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidManifestError";
  }
}

export interface ValidateManifestOptions {
  /**
   * Allow shard file references that resolve to a different origin
   * than the manifest itself. Off by default — a compromised or
   * misconfigured manifest shouldn't be able to make the client fetch
   * arbitrary cross-origin URLs (REVIEW.md#6).
   */
  allowCrossOriginShards?: boolean;
  /**
   * Adds semantic checks beyond the always-on structural/security ones
   * above (issue #1 finding 7): every `shards.terms[*].lang` is actually
   * in `languages`, `(lang, prefix)` pairs are unique, `format` is a
   * recognized value, every `shards.docs[*].idRange` is a valid ordered
   * tuple, and `docCount`/`avgFieldLength` cover every declared
   * language. Off by default — these catch a genuinely malformed or
   * independently-produced manifest (docs/concepts/index-format.md)
   * with a clear, specific error instead of a confusing failure deep
   * inside query execution, but they're extra work on every manifest
   * load that a production deployment serving its own known-good,
   * indexer-built manifest doesn't need to pay for on every page view.
   * Meant for dev/test and independent-producer conformance checking,
   * not gating what's already always validated (cross-origin shard
   * URLs, version, required top-level fields) — this option only adds
   * checks, it never removes one.
   */
  strict?: boolean;
}

function checkTermShardsStrict(
  terms: unknown,
  languages: readonly string[],
): void {
  if (!Array.isArray(terms)) return; // already reported by the always-on check
  const seen = new Set<string>();
  terms.forEach((entry, i) => {
    const e = entry as Record<string, unknown> | null;
    const context = `shards.terms[${i}]`;
    if (typeof e?.lang !== "string" || !languages.includes(e.lang)) {
      fail(`${context}.lang ${JSON.stringify(e?.lang)} is not in languages`);
    }
    if (typeof e.prefix !== "string" || e.prefix.length === 0) {
      fail(`${context}.prefix must be a non-empty string`);
    }
    const key = `${e.lang}\0${e.prefix}`;
    if (seen.has(key)) {
      fail(
        `${context}: duplicate (lang, prefix) pair (${e.lang}, "${e.prefix}") — every term shard must cover a distinct prefix per language`,
      );
    }
    seen.add(key);
    if (
      e.format !== undefined &&
      e.format !== "json" &&
      e.format !== "binary"
    ) {
      fail(`${context}.format must be absent, "json", or "binary"`);
    }
  });
}

function checkIdRange(idRange: unknown, context: string): void {
  if (
    !Array.isArray(idRange) ||
    idRange.length !== 2 ||
    !idRange.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    fail(`${context}.idRange must be a two-number tuple`);
  }
  const [min, max] = idRange as [number, number];
  if (min > max) {
    fail(`${context}.idRange [${min}, ${max}] must be ordered (min <= max)`);
  }
}

function checkDocsShardsStrict(docs: unknown): void {
  if (!Array.isArray(docs)) return; // already reported by the always-on check
  docs.forEach((entry, i) => {
    const e = entry as Record<string, unknown> | null;
    checkIdRange(e?.idRange, `shards.docs[${i}]`);
  });
}

function checkPerLanguageCoverageStrict(
  value: unknown,
  languages: readonly string[],
  fieldName: string,
): void {
  const v = value as Record<string, unknown> | null;
  for (const lang of languages) {
    if (!v || !(lang in v)) {
      fail(`${fieldName} is missing an entry for language "${lang}"`);
    }
  }
}

function fail(message: string): never {
  throw new InvalidManifestError(`invalid manifest: ${message}`);
}

function checkShardFile(
  file: unknown,
  manifestUrl: string,
  allowCrossOrigin: boolean,
  context: string,
): void {
  if (typeof file !== "string" || file.length === 0) {
    fail(`${context}.file must be a non-empty string`);
  }
  if (allowCrossOrigin) return;

  let resolved: URL;
  try {
    resolved = new URL(file, manifestUrl);
  } catch {
    fail(`${context}.file "${file}" is not a valid relative or absolute URL`);
  }
  const manifestOrigin = new URL(manifestUrl).origin;
  if (resolved.origin !== manifestOrigin) {
    fail(
      `${context}.file "${file}" resolves to a different origin (${resolved.origin}) than the manifest (${manifestOrigin}) — pass allowCrossOriginShards: true to opt in`,
    );
  }
}

function checkShardFileArray(
  entries: unknown,
  manifestUrl: string,
  allowCrossOrigin: boolean,
  context: string,
): void {
  if (!Array.isArray(entries)) fail(`${context} must be an array`);
  entries.forEach((entry, i) => {
    const file = (entry as Record<string, unknown> | null)?.file;
    checkShardFile(file, manifestUrl, allowCrossOrigin, `${context}[${i}]`);
  });
}

/**
 * Validates a freshly-fetched manifest's shape before the client trusts
 * it for query execution. `fetchJson<Manifest>()` alone only guarantees
 * the response was valid JSON, not that it matches the `Manifest`
 * shape — a corrupt, stale, or incompatible manifest should fail here,
 * clearly, rather than surfacing as `undefined` deep inside `search()`.
 */
export function validateManifest(
  data: unknown,
  manifestUrl: string,
  options: ValidateManifestOptions = {},
): Manifest {
  if (typeof data !== "object" || data === null) {
    fail("must be a JSON object");
  }
  const m = data as Record<string, unknown>;

  if (m.version !== 1) {
    fail(`unsupported version ${JSON.stringify(m.version)} (expected 1)`);
  }
  if (m.format !== "json" && m.format !== "binary") {
    fail(`format must be "json" or "binary", got ${JSON.stringify(m.format)}`);
  }
  if (
    !Array.isArray(m.languages) ||
    m.languages.length === 0 ||
    !m.languages.every((l) => typeof l === "string")
  ) {
    fail("languages must be a non-empty array of strings");
  }
  if (
    typeof m.defaultLanguage !== "string" ||
    !(m.languages as string[]).includes(m.defaultLanguage)
  ) {
    fail(
      `defaultLanguage ${JSON.stringify(m.defaultLanguage)} must be a string present in languages`,
    );
  }
  if (typeof m.fields !== "object" || m.fields === null) {
    fail("fields must be an object");
  }
  if (typeof m.docCount !== "object" || m.docCount === null) {
    fail("docCount must be an object keyed by language");
  }
  if (typeof m.avgFieldLength !== "object" || m.avgFieldLength === null) {
    fail("avgFieldLength must be an object keyed by language");
  }
  if (typeof m.shards !== "object" || m.shards === null) {
    fail("shards must be an object");
  }

  const shards = m.shards as Record<string, unknown>;
  const allowCrossOrigin = options.allowCrossOriginShards ?? false;
  const strict = options.strict ?? false;
  checkShardFileArray(
    shards.terms,
    manifestUrl,
    allowCrossOrigin,
    "shards.terms",
  );
  checkShardFileArray(
    shards.docs,
    manifestUrl,
    allowCrossOrigin,
    "shards.docs",
  );
  if (strict) {
    const languages = m.languages as string[];
    checkTermShardsStrict(shards.terms, languages);
    checkDocsShardsStrict(shards.docs);
    checkPerLanguageCoverageStrict(m.docCount, languages, "docCount");
    checkPerLanguageCoverageStrict(
      m.avgFieldLength,
      languages,
      "avgFieldLength",
    );
  }
  if (shards.facets !== undefined) {
    checkShardFileArray(
      shards.facets,
      manifestUrl,
      allowCrossOrigin,
      "shards.facets",
    );
  }
  if (m.pins !== undefined) {
    if (typeof m.pins !== "object" || m.pins === null) {
      fail("pins must be an object keyed by language");
    }
    for (const [lang, file] of Object.entries(
      m.pins as Record<string, unknown>,
    )) {
      checkShardFile(file, manifestUrl, allowCrossOrigin, `pins.${lang}`);
    }
  }
  if (m.synonyms !== undefined) {
    if (typeof m.synonyms !== "object" || m.synonyms === null) {
      fail("synonyms must be an object keyed by language");
    }
    for (const [lang, file] of Object.entries(
      m.synonyms as Record<string, unknown>,
    )) {
      checkShardFile(file, manifestUrl, allowCrossOrigin, `synonyms.${lang}`);
    }
  }
  if (m.fuzzy !== undefined) {
    if (typeof m.fuzzy !== "object" || m.fuzzy === null) {
      fail("fuzzy must be an object keyed by language");
    }
    for (const [lang, descriptor] of Object.entries(
      m.fuzzy as Record<string, unknown>,
    )) {
      if (typeof descriptor !== "object" || descriptor === null) {
        fail(`fuzzy.${lang} must be an object`);
      }
      const file = (descriptor as Record<string, unknown>).file;
      checkShardFile(file, manifestUrl, allowCrossOrigin, `fuzzy.${lang}`);
    }
  }
  return data as Manifest;
}
