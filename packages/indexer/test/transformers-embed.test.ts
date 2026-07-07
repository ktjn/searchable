import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `pipeline` is mocked so these tests exercise this module's own
 * batching/slicing/caching logic without any network access -- the real
 * `@huggingface/transformers` pipeline fetches model weights from
 * `huggingface.co` on first use, which this sandboxed test environment
 * has no route to. The one test that talks to the real library is gated
 * behind `CSF_TEST_REAL_TRANSFORMERS` below and skipped by default.
 */
const pipelineMock = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

function fakeExtractor(dims: number) {
  return vi.fn(async (texts: string[]) => {
    const data = new Float32Array(texts.length * dims);
    for (let i = 0; i < texts.length; i++) {
      for (let d = 0; d < dims; d++) {
        // Deterministic per-text, per-dim values so slicing can be asserted exactly.
        data[i * dims + d] = i * 100 + d;
      }
    }
    return { data, dims: [texts.length, dims] };
  });
}

describe("createTransformersEmbedder", () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it("loads the default model and dtype when none is given", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder, DEFAULT_TRANSFORMERS_MODEL } =
      await import("../src/transformers-embed.js");
    await createTransformersEmbedder();

    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      DEFAULT_TRANSFORMERS_MODEL,
      { dtype: "q8" },
    );
  });

  it("passes through an explicit model and dtype", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder } = await import(
      "../src/transformers-embed.js"
    );
    await createTransformersEmbedder({ model: "some/model", dtype: "fp32" });

    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      "some/model",
      {
        dtype: "fp32",
      },
    );
  });

  it("reports embeddingProvider metadata matching the loaded model", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder } = await import(
      "../src/transformers-embed.js"
    );
    const { provider } = await createTransformersEmbedder({ model: "a/b" });

    expect(provider).toEqual({ type: "local-model", model: "a/b" });
  });

  it("slices the flattened batch output back into one vector per input text", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = await createTransformersEmbedder();
    const vectors = await embed(["first", "second", "third"]);

    expect(vectors).toEqual([
      [0, 1, 2],
      [100, 101, 102],
      [200, 201, 202],
    ]);
  });

  it("calls the extractor once with the whole batch, mean-pooled and normalized", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = await createTransformersEmbedder();
    await embed(["a", "b"]);

    expect(extractor).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledWith(["a", "b"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it("returns an empty array for an empty input without calling the extractor", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedder } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = await createTransformersEmbedder();
    const vectors = await embed([]);

    expect(vectors).toEqual([]);
    expect(extractor).not.toHaveBeenCalled();
  });
});

/**
 * Real, non-mocked run against the actual Hugging Face Hub -- requires
 * network access to huggingface.co (blocked in this project's own CI
 * sandbox and some contributors' environments), so it's opt-in only.
 * Run with: CSF_TEST_REAL_TRANSFORMERS=1 pnpm --filter @csf/indexer test
 */
describe.skipIf(!process.env.CSF_TEST_REAL_TRANSFORMERS)(
  "createTransformersEmbedder (real model, opt-in)",
  () => {
    it("embeds real text into a 384-dim normalized vector", async () => {
      vi.doUnmock("@huggingface/transformers");
      vi.resetModules();
      const { createTransformersEmbedder } = await import(
        "../src/transformers-embed.js"
      );
      const { embed, provider } = await createTransformersEmbedder();
      const vectors = await embed(["hello world"]);
      const vector = vectors[0];

      expect(vector).toHaveLength(384);
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 2);
      expect(provider).toEqual({
        type: "local-model",
        model: "Xenova/all-MiniLM-L6-v2",
      });
    }, 120_000);
  },
);
