import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Manifest, TermShard } from "@csf/format";
import { encodeTermShardBinary } from "./binary-term-shard.js";
import { contentHash } from "./hash.js";
import type { BuiltIndex } from "./types.js";

/**
 * Recursively sorts object keys (array element order is left alone --
 * it's semantically meaningful for postings/doc-id lists) so the same
 * logical data always serializes to the same bytes regardless of
 * insertion order. `JSON.stringify` alone is deterministic for one
 * producer's own iteration order, but not guaranteed stable across
 * independent producers or a corpus fed in a different order
 * (REVIEW.md#10) -- sorting keys before serializing removes that
 * degree of freedom entirely.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

async function writeJson(
  outDir: string,
  relPath: string,
  data: unknown,
): Promise<string> {
  const json = JSON.stringify(canonicalize(data));
  const hash = contentHash(json);
  const hashedRelPath = relPath.replace(/\.json$/, `.${hash}.json`);
  const absPath = join(outDir, hashedRelPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, json, "utf8");
  return hashedRelPath;
}

async function writeBinary(
  outDir: string,
  relPath: string,
  data: Uint8Array,
): Promise<string> {
  const hash = contentHash(data);
  const hashedRelPath = relPath.replace(/\.bin$/, `.${hash}.bin`);
  const absPath = join(outDir, hashedRelPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, data);
  return hashedRelPath;
}

/** Default per docs/02-index-format.md#size-targets--sharding-tuning ("e.g. ~50KB gzipped"). */
export const DEFAULT_MAX_TERM_SHARD_GZIP_BYTES = 50 * 1024;

function groupByPrefixLength(
  termShard: TermShard,
  prefixLength: number,
): Map<string, TermShard> {
  const groups = new Map<string, TermShard>();
  for (const [term, entry] of Object.entries(termShard)) {
    const prefix = term.slice(0, prefixLength);
    let group = groups.get(prefix);
    if (!group) {
      group = {};
      groups.set(prefix, group);
    }
    group[term] = entry;
  }
  return groups;
}

function gzipByteSize(termShard: TermShard): number {
  return gzipSync(JSON.stringify(canonicalize(termShard))).length;
}

/** A prefix length past which auto-splitting gives up even if still over budget -- a safety net against runaway recursion, not a limit expected to bind in practice (docs/02's own examples never go past two characters). */
const MAX_PREFIX_LENGTH = 8;

/**
 * Splits one bucket further by one more prefix character, recursing into
 * any resulting sub-bucket that's *still* over `maxGzipBytes` -- docs/02's
 * "auto-increases prefix length ... for over-large shards" is not capped
 * at two characters: a sufficiently dense leading substring (common in
 * agglutinative/compounding languages like German at real corpus scale)
 * can still be too large even after one split, so this keeps widening
 * per over-large sub-bucket until it fits, terms stop separating further
 * (`subBuckets.size <= 1` -- can't split a bucket by prefix if every term
 * in it already shares that whole prefix), or `MAX_PREFIX_LENGTH` is hit,
 * whichever comes first -- the latter two both emit a warning rather
 * than fail the build, since a corpus dense enough to hit either in
 * practice needs the binary tier this shard format is deliberately
 * staying open-and-simple ahead of (docs/11-binary-vs-json-index.md),
 * not open-ended JSON prefix recursion.
 */
function splitOversizedBucket(
  prefix: string,
  group: TermShard,
  prefixLength: number,
  language: string,
  maxGzipBytes: number,
  result: Map<string, TermShard>,
): void {
  const size = gzipByteSize(group);
  if (size <= maxGzipBytes) {
    result.set(prefix, group);
    return;
  }
  const termCount = Object.keys(group).length;
  if (termCount <= 1 || prefixLength >= MAX_PREFIX_LENGTH) {
    const reason =
      termCount <= 1
        ? "only one term left"
        : `hit the ${MAX_PREFIX_LENGTH}-character prefix-length cap`;
    console.warn(
      `[csf-indexer] term shard [${language}] prefix "${prefix}" is ${size} gzip bytes, over the ${maxGzipBytes}-byte budget and cannot be split further (${reason}) -- see docs/02-index-format.md#size-targets--sharding-tuning.`,
    );
    result.set(prefix, group);
    return;
  }
  const subBuckets = groupByPrefixLength(group, prefixLength + 1);
  if (subBuckets.size <= 1) {
    console.warn(
      `[csf-indexer] term shard [${language}] prefix "${prefix}" is ${size} gzip bytes, over the ${maxGzipBytes}-byte budget, but every term in it shares the same prefix so it cannot be split further -- see docs/02-index-format.md#size-targets--sharding-tuning.`,
    );
    result.set(prefix, group);
    return;
  }
  for (const [subPrefix, subGroup] of subBuckets) {
    splitOversizedBucket(
      subPrefix,
      subGroup,
      prefixLength + 1,
      language,
      maxGzipBytes,
      result,
    );
  }
}

/**
 * Splits one language's term shard into prefix buckets
 * (docs/02-index-format.md#term-shard-inverted-index): single-character
 * prefix by default, so a query for "widget" only ever needs the "w"
 * bucket, regardless of how many other terms exist. A bucket that would
 * still exceed `maxGzipBytes` after gzip is widened one character at a
 * time (`splitOversizedBucket` above) rather than left as one oversized
 * fetch every one-character-prefix query would have to pay for.
 */
function shardTermsByPrefix(
  termShard: TermShard,
  language: string,
  maxGzipBytes: number,
): Map<string, TermShard> {
  const result = new Map<string, TermShard>();
  for (const [prefix, group] of groupByPrefixLength(termShard, 1)) {
    splitOversizedBucket(prefix, group, 1, language, maxGzipBytes, result);
  }
  return result;
}

/**
 * Serializes a BuiltIndex to content-hashed shard files plus a plain
 * (unhashed) manifest.json — the full hashed-manifest + alias-pointer
 * scheme from docs/02-index-format.md#versioning--cache-strategy is a
 * deliberate simplification left for when a real deployment needs it;
 * shard immutability (the property that actually matters for caching)
 * is implemented as designed.
 *
 * Builds a fresh manifest object rather than mutating `built.manifest`
 * in place, so the `BuiltIndex` a caller got back from `buildIndex()`
 * stays exactly what it was — a caller holding onto that reference
 * shouldn't see it silently change shape out from under them just
 * because they also called `writeIndex()` (REVIEW.md#9).
 */
export interface WriteIndexOptions {
  /** See `DEFAULT_MAX_TERM_SHARD_GZIP_BYTES` and `shardTermsByPrefix()` above. */
  maxShardGzipBytes?: number;
  /**
   * `false` writes exactly one term shard per language (`prefix: "all"`)
   * instead of splitting by first-character prefix -- the same shard
   * *format* either way, just configured with one shard instead of many.
   * Real per-prefix sharding is solving a fetch-size problem that
   * doesn't exist yet for a small enough corpus
   * (docs/14-reference-deployment-cms-2k.md#what-to-simplify-at-this-scale).
   * Defaults to `true` (real prefix sharding, the general-case default).
   */
  shardByPrefix?: boolean;
  /**
   * `"binary"` writes term shards with the directory-based delta+varint
   * encoding (`./binary-term-shard.js`, validated in
   * `packages/indexer/bench/binary-lazy-decode.mjs` — see
   * docs/11-binary-vs-json-index.md), one `.bin` file per prefix bucket
   * with `format: "binary"` recorded on that shard's manifest entry, in
   * place of the plain-JSON `terms/<lang>/<prefix>.json` shape.
   * Defaults to `"json"`. Every other shard type (facets, doc store,
   * pins, synonyms, fuzzy) stays JSON either way — this option is
   * term-shard-only, matching docs/spec-binary-format.md's "a
   * deployment may mix JSON and binary files" allowance.
   */
  termShardFormat?: "json" | "binary";
}

export async function writeIndex(
  built: BuiltIndex,
  outDir: string,
  options: WriteIndexOptions = {},
): Promise<void> {
  const maxGzipBytes =
    options.maxShardGzipBytes ?? DEFAULT_MAX_TERM_SHARD_GZIP_BYTES;
  const shardByPrefix = options.shardByPrefix ?? true;
  const termShardFormat = options.termShardFormat ?? "json";
  const languages = Object.keys(built.termShards).sort();
  const terms = (
    await Promise.all(
      languages.map(async (language) => {
        const termShard = built.termShards[language] ?? {};
        const buckets = shardByPrefix
          ? [...shardTermsByPrefix(termShard, language, maxGzipBytes)].sort(
              ([a], [b]) => a.localeCompare(b),
            )
          : ([["all", termShard]] as [string, TermShard][]);
        return Promise.all(
          buckets.map(async ([prefix, group]) => {
            const file =
              termShardFormat === "binary"
                ? await writeBinary(
                    outDir,
                    `terms/${language}/${prefix}.bin`,
                    encodeTermShardBinary(group),
                  )
                : await writeJson(
                    outDir,
                    `terms/${language}/${prefix}.json`,
                    group,
                  );
            return {
              lang: language,
              prefix,
              file,
              termCount: Object.keys(group).length,
              ...(termShardFormat === "binary"
                ? { format: "binary" as const }
                : {}),
            };
          }),
        );
      }),
    )
  ).flat();

  const docsFile = await writeJson(outDir, "docs/0.json", built.docStore);
  const docs = [{ shard: 0, file: docsFile, idRange: built.idRange }];

  const facetFields = Object.keys(built.facetShards).sort();
  const facets = facetFields.length
    ? await Promise.all(
        facetFields.map(async (field) => ({
          field,
          file: await writeJson(
            outDir,
            `facets/${field}.json`,
            built.facetShards[field],
          ),
        })),
      )
    : undefined;

  const pinLanguages = Object.keys(built.pinsShards)
    .filter((language) => Object.keys(built.pinsShards[language] ?? {}).length)
    .sort();
  let pins: Record<string, string> | undefined;
  if (pinLanguages.length) {
    pins = {};
    for (const language of pinLanguages) {
      pins[language] = await writeJson(
        outDir,
        `pins/${language}.json`,
        built.pinsShards[language],
      );
    }
  }

  const synonymLanguages = Object.keys(built.synonymShards)
    .filter((language) => {
      const shard = built.synonymShards[language];
      return (
        (shard?.equivalences?.length ?? 0) > 0 ||
        Object.keys(shard?.directional ?? {}).length > 0 ||
        (shard?.multiWord?.length ?? 0) > 0
      );
    })
    .sort();
  let synonyms: Record<string, string> | undefined;
  if (synonymLanguages.length) {
    synonyms = {};
    for (const language of synonymLanguages) {
      synonyms[language] = await writeJson(
        outDir,
        `synonyms/${language}.json`,
        built.synonymShards[language],
      );
    }
  }

  const fuzzyLanguages = Object.keys(built.fuzzyShards)
    .filter(
      (language) =>
        Object.keys(built.fuzzyShards[language]?.deletions ?? {}).length,
    )
    .sort();
  let fuzzy: Record<string, string> | undefined;
  if (fuzzyLanguages.length) {
    fuzzy = {};
    for (const language of fuzzyLanguages) {
      fuzzy[language] = await writeJson(
        outDir,
        `fuzzy/${language}.json`,
        built.fuzzyShards[language],
      );
    }
  }

  const manifest: Manifest = {
    ...built.manifest,
    shards: {
      terms,
      docs,
      ...(facets ? { facets } : {}),
    },
    ...(pins ? { pins } : {}),
    ...(synonyms ? { synonyms } : {}),
    ...(fuzzy ? { fuzzy } : {}),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(canonicalize(manifest)),
    "utf8",
  );
}
