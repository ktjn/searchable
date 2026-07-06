import type { Manifest } from "@csf/format";

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
  if (m.vectors !== undefined) {
    if (typeof m.vectors !== "object" || m.vectors === null) {
      fail("vectors must be an object");
    }
    const vectors = m.vectors as Record<string, unknown>;
    if (!Number.isInteger(vectors.dims) || (vectors.dims as number) < 1) {
      fail("vectors.dims must be a positive integer");
    }
    if (vectors.quantization !== "float32" && vectors.quantization !== "int8") {
      fail('vectors.quantization must be "float32" or "int8"');
    }
    if (
      typeof vectors.embeddingProvider !== "object" ||
      vectors.embeddingProvider === null
    ) {
      fail("vectors.embeddingProvider must be an object");
    }
    if (typeof vectors.shards !== "object" || vectors.shards === null) {
      fail("vectors.shards must be an object keyed by language");
    }
    for (const [lang, file] of Object.entries(
      vectors.shards as Record<string, unknown>,
    )) {
      checkShardFile(
        file,
        manifestUrl,
        allowCrossOrigin,
        `vectors.shards.${lang}`,
      );
    }
  }

  return data as Manifest;
}
