import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { contentHash } from "./hash.js";
import type { BuiltIndex } from "./types.js";

async function writeJson(
  outDir: string,
  relPath: string,
  data: unknown,
): Promise<string> {
  const json = JSON.stringify(data);
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
 */
export async function writeIndex(
  built: BuiltIndex,
  outDir: string,
): Promise<void> {
  const languages = Object.keys(built.termShards).sort();
  built.manifest.shards.terms = await Promise.all(
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
  built.manifest.shards.docs = [
    { shard: 0, file: docsFile, idRange: built.idRange },
  ];

  const facetFields = Object.keys(built.facetShards).sort();
  if (facetFields.length) {
    built.manifest.shards.facets = await Promise.all(
      facetFields.map(async (field) => ({
        field,
        file: await writeJson(
          outDir,
          `facets/${field}.json`,
          built.facetShards[field],
        ),
      })),
    );
  }

  const pinLanguages = Object.keys(built.pinsShards)
    .filter((language) => Object.keys(built.pinsShards[language] ?? {}).length)
    .sort();
  if (pinLanguages.length) {
    const pins: Record<string, string> = {};
    for (const language of pinLanguages) {
      pins[language] = await writeJson(
        outDir,
        `pins/${language}.json`,
        built.pinsShards[language],
      );
    }
    built.manifest.pins = pins;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(built.manifest),
    "utf8",
  );
}
