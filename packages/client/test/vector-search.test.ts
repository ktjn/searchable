import type { VectorShard } from "@ktjn/searchable-format";
import { describe, expect, it } from "vitest";
import {
  bruteForceVectorSearch,
  cosineSimilarity,
  dequantizeVector,
  reciprocalRankFusion,
} from "../src/vector-search.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it("is 0 (not NaN) when either vector is all-zero", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });
});

describe("dequantizeVector", () => {
  it("passes float32 vectors through unchanged", () => {
    const shard: VectorShard = {
      dims: 3,
      quantization: "float32",
      entries: [],
    };
    expect(dequantizeVector([1.5, -2.25, 0], shard)).toEqual([1.5, -2.25, 0]);
  });

  it("scales int8 raw bytes back through quantRange", () => {
    const shard: VectorShard = {
      dims: 2,
      quantization: "int8",
      quantRange: { min: -10, max: 10 },
      entries: [],
    };
    expect(dequantizeVector([0, 255], shard)).toEqual([-10, 10]);
    // Midpoint byte (127.5 rounds to 128 at build time) dequantizes back
    // near 0, within one quantization step.
    const [mid] = dequantizeVector([128, 128], shard);
    expect(mid as number).toBeCloseTo(0.04, 2);
  });
});

const shardFor = (
  entries: { docId: number; passageId: string; vector: number[] }[],
): VectorShard => ({
  dims: entries[0]?.vector.length ?? 0,
  quantization: "float32",
  entries,
});

describe("bruteForceVectorSearch", () => {
  it("ranks entries by cosine similarity descending", () => {
    const shard = shardFor([
      { docId: 1, passageId: "1-0", vector: [1, 0] },
      { docId: 2, passageId: "2-0", vector: [0.7, 0.7] },
      { docId: 3, passageId: "3-0", vector: [0, 1] },
    ]);
    const hits = bruteForceVectorSearch([1, 0], shard, 10);
    expect(hits.map((h) => h.docId)).toEqual([1, 2, 3]);
    expect(hits[0]?.score).toBeCloseTo(1, 10);
    expect(hits[2]?.score).toBeCloseTo(0, 10);
  });

  it("keeps only the best-scoring passage per document", () => {
    const shard = shardFor([
      { docId: 1, passageId: "1-0", vector: [0, 1] }, // orthogonal, weak
      { docId: 1, passageId: "1-1", vector: [1, 0] }, // identical, strong
    ]);
    const hits = bruteForceVectorSearch([1, 0], shard, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.passageId).toBe("1-1");
    expect(hits[0]?.score).toBeCloseTo(1, 10);
  });

  it("truncates to limit", () => {
    const shard = shardFor(
      Array.from({ length: 5 }, (_, i) => ({
        docId: i,
        passageId: `${i}-0`,
        vector: [1, i],
      })),
    );
    expect(bruteForceVectorSearch([1, 0], shard, 2)).toHaveLength(2);
  });

  it("returns an empty array for an empty shard", () => {
    expect(bruteForceVectorSearch([1, 0], shardFor([]), 10)).toEqual([]);
  });
});

describe("reciprocalRankFusion", () => {
  it("sums 1/(k+rank) across every list an id appears in", () => {
    const fused = reciprocalRankFusion(
      [
        [1, 2, 3],
        [2, 1, 4],
      ],
      10,
    );
    // id 1: rank 1 in list A (1/11), rank 2 in list B (1/12)
    expect(fused.get(1)).toBeCloseTo(1 / 11 + 1 / 12, 10);
    // id 2: rank 2 in list A (1/12), rank 1 in list B (1/11)
    expect(fused.get(2)).toBeCloseTo(1 / 12 + 1 / 11, 10);
    // id 3: rank 3 in list A only (1/13)
    expect(fused.get(3)).toBeCloseTo(1 / 13, 10);
    // id 4: rank 3 in list B only (1/13)
    expect(fused.get(4)).toBeCloseTo(1 / 13, 10);
    expect(fused.get(1)).toEqual(fused.get(2));
  });

  it("defaults k to 60", () => {
    const fused = reciprocalRankFusion([[42]]);
    expect(fused.get(42)).toBeCloseTo(1 / 61, 10);
  });

  it("returns an empty map for no lists", () => {
    expect(reciprocalRankFusion([]).size).toBe(0);
  });
});
