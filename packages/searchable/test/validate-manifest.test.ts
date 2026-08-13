import { describe, expect, it } from "vitest";
import {
  InvalidManifestError,
  validateManifest,
} from "../src/validate-manifest.js";

const MANIFEST_URL = "https://cdn.example.com/search-index/manifest.json";

function validManifest(): Record<string, unknown> {
  return {
    version: 2,
    buildId: "test",
    languages: ["en"],
    defaultLanguage: "en",
    fields: { title: { boost: 3, stored: true } },
    docCount: { en: 10 },
    avgFieldLength: { en: { title: 5 } },
    shards: {
      terms: [
        { lang: "en", prefix: "all", file: "terms/en/all.json", termCount: 5 },
      ],
      docs: [{ shard: 0, file: "docs/0.json", idRange: [0, 9] }],
    },
  };
}

describe("validateManifest", () => {
  it("returns a structurally valid manifest as-is", () => {
    const manifest = validManifest();
    expect(validateManifest(manifest, MANIFEST_URL)).toBe(manifest);
  });

  it("rejects a non-object", () => {
    expect(() => validateManifest(null, MANIFEST_URL)).toThrow(
      InvalidManifestError,
    );
    expect(() => validateManifest("nope", MANIFEST_URL)).toThrow(
      InvalidManifestError,
    );
  });

  it("rejects an unsupported version", () => {
    const manifest = { ...validManifest(), version: 1 };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /unsupported version/,
    );
  });

  it("rejects an empty languages array", () => {
    const manifest = { ...validManifest(), languages: [] };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(/languages/);
  });

  it("rejects a defaultLanguage not present in languages", () => {
    const manifest = { ...validManifest(), defaultLanguage: "de" };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /defaultLanguage/,
    );
  });

  it("rejects a missing docCount", () => {
    const manifest = validManifest();
    manifest.docCount = undefined;
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(/docCount/);
  });

  it("rejects a missing avgFieldLength", () => {
    const manifest = validManifest();
    manifest.avgFieldLength = undefined;
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /avgFieldLength/,
    );
  });

  it("rejects shards.terms that isn't an array", () => {
    const manifest = validManifest();
    (manifest.shards as Record<string, unknown>).terms = "nope";
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /shards\.terms/,
    );
  });

  it("rejects a shard entry with a non-string file", () => {
    const manifest = validManifest();
    (manifest.shards as { docs: unknown[] }).docs = [
      { shard: 0, idRange: [0, 9] },
    ];
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /shards\.docs\[0\]\.file/,
    );
  });

  it("rejects a shard file that resolves cross-origin by default", () => {
    const manifest = validManifest();
    (
      manifest.shards as { terms: Array<Record<string, unknown>> }
    ).terms[0].file = "https://evil.example.com/terms/en/all.json";
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /different origin/,
    );
  });

  it("allows a cross-origin shard file when allowCrossOriginShards is set", () => {
    const manifest = validManifest();
    (
      manifest.shards as { terms: Array<Record<string, unknown>> }
    ).terms[0].file = "https://evil.example.com/terms/en/all.json";
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, {
        allowCrossOriginShards: true,
      }),
    ).not.toThrow();
  });

  it("allows a same-origin absolute shard file by default", () => {
    const manifest = validManifest();
    (
      manifest.shards as { terms: Array<Record<string, unknown>> }
    ).terms[0].file = "https://cdn.example.com/search-index/terms/en/all.json";
    expect(() => validateManifest(manifest, MANIFEST_URL)).not.toThrow();
  });

  it("rejects a pins entry that resolves cross-origin by default", () => {
    const manifest = {
      ...validManifest(),
      pins: { en: "https://evil.example.com/pins/en.json" },
    };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /different origin/,
    );
  });

  it("rejects a synonyms entry that resolves cross-origin by default", () => {
    const manifest = {
      ...validManifest(),
      synonyms: { en: "https://evil.example.com/synonyms/en.json" },
    };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /different origin/,
    );
  });

  it("allows a same-origin synonyms entry", () => {
    const manifest = {
      ...validManifest(),
      synonyms: { en: "synonyms/en.json" },
    };
    expect(() => validateManifest(manifest, MANIFEST_URL)).not.toThrow();
  });

  it("allows a cross-origin synonyms entry when allowCrossOriginShards is set", () => {
    const manifest = {
      ...validManifest(),
      synonyms: { en: "https://evil.example.com/synonyms/en.json" },
    };
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, {
        allowCrossOriginShards: true,
      }),
    ).not.toThrow();
  });
});

/**
 * Issue #1 finding 7 (productization review): semantic checks beyond
 * the always-on structural/security ones, off by default (a production
 * deployment's own known-good manifest shouldn't pay extra validation
 * cost on every page view) but available for dev/test and independent-
 * producer conformance checking.
 */
describe("validateManifest: strict mode", () => {
  it("does not run strict checks by default, even on an otherwise strict-invalid manifest", () => {
    const manifest = {
      ...validManifest(),
      shards: {
        ...(validManifest().shards as Record<string, unknown>),
        terms: [
          { lang: "de", prefix: "all", file: "terms/en/all.json" }, // "de" not in languages
        ],
      },
    };
    expect(() => validateManifest(manifest, MANIFEST_URL)).not.toThrow();
  });

  it("rejects a term shard lang not present in languages", () => {
    const manifest = validManifest();
    (manifest.shards as { terms: Array<Record<string, unknown>> }).terms = [
      { lang: "de", prefix: "all", file: "terms/en/all.json" },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/lang.*not in languages/);
  });

  it("rejects a term shard with an empty prefix", () => {
    const manifest = validManifest();
    (manifest.shards as { terms: Array<Record<string, unknown>> }).terms = [
      { lang: "en", prefix: "", file: "terms/en/all.json" },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/prefix must be a non-empty string/);
  });

  it("rejects duplicate (lang, prefix) pairs across term shards", () => {
    const manifest = validManifest();
    (manifest.shards as { terms: Array<Record<string, unknown>> }).terms = [
      { lang: "en", prefix: "a", file: "terms/en/a.json" },
      { lang: "en", prefix: "a", file: "terms/en/a2.json" },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/duplicate \(lang, prefix\) pair/);
  });

  it("accepts a term shard without a format field in strict mode", () => {
    const manifest = validManifest();
    (manifest.shards as { terms: Array<Record<string, unknown>> }).terms = [
      { lang: "en", prefix: "all", file: "terms/en/all.json" },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).not.toThrow();
  });

  it("rejects a docs shard idRange that isn't a two-number tuple", () => {
    const manifest = validManifest();
    (manifest.shards as { docs: Array<Record<string, unknown>> }).docs = [
      { shard: 0, file: "docs/0.json", idRange: [0] },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/idRange must be a two-number tuple/);
  });

  it("rejects a docs shard idRange that isn't ordered (min > max)", () => {
    const manifest = validManifest();
    (manifest.shards as { docs: Array<Record<string, unknown>> }).docs = [
      { shard: 0, file: "docs/0.json", idRange: [9, 0] },
    ];
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/must be ordered/);
  });

  it("rejects docCount missing an entry for a declared language", () => {
    const manifest = {
      ...validManifest(),
      languages: ["en", "de"],
      docCount: { en: 10 }, // missing "de"
    };
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/docCount is missing an entry for language "de"/);
  });

  it("rejects avgFieldLength missing an entry for a declared language", () => {
    const manifest = {
      ...validManifest(),
      languages: ["en", "de"],
      docCount: { en: 10, de: 5 },
      avgFieldLength: { en: { title: 5 } }, // missing "de"
    };
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).toThrow(/avgFieldLength is missing an entry for language "de"/);
  });

  it("accepts a fully well-formed manifest under strict mode", () => {
    const manifest = validManifest();
    expect(() =>
      validateManifest(manifest, MANIFEST_URL, { strict: true }),
    ).not.toThrow();
  });
});
