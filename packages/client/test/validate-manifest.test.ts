import { describe, expect, it } from "vitest";
import {
  InvalidManifestError,
  validateManifest,
} from "../src/validate-manifest.js";

const MANIFEST_URL = "https://cdn.example.com/search-index/manifest.json";

function validManifest(): Record<string, unknown> {
  return {
    version: 1,
    buildId: "test",
    format: "json",
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
    const manifest = { ...validManifest(), version: 2 };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(
      /unsupported version/,
    );
  });

  it("rejects an invalid format", () => {
    const manifest = { ...validManifest(), format: "xml" };
    expect(() => validateManifest(manifest, MANIFEST_URL)).toThrow(/format/);
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
});
