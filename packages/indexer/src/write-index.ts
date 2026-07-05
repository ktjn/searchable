import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Manifest } from "@csf/format";
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
export async function writeIndex(
  built: BuiltIndex,
  outDir: string,
): Promise<void> {
  const languages = Object.keys(built.termShards).sort();
  const terms = await Promise.all(
    languages.map(async (language) => {
      const termShard = built.termShards[language] ?? {};
      return {
        lang: language,
        prefix: "all",
        file: await writeJson(outDir, `terms/${language}/all.json`, termShard),
        termCount: Object.keys(termShard).length,
      };
    }),
  );

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
        Object.keys(shard?.directional ?? {}).length > 0
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

  const manifest: Manifest = {
    ...built.manifest,
    shards: {
      terms,
      docs,
      ...(facets ? { facets } : {}),
    },
    ...(pins ? { pins } : {}),
    ...(synonyms ? { synonyms } : {}),
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(canonicalize(manifest)),
    "utf8",
  );
}
