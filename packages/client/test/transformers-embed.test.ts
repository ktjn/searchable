import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `pipeline` is mocked so these tests exercise this module's own lazy-load
 * caching and batch-of-one slicing logic without network access -- the
 * real `@huggingface/transformers` pipeline fetches model weights from
 * huggingface.co on first use, which this sandboxed test environment has
 * no route to. The one test that talks to the real library is gated
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
        data[i * dims + d] = i * 100 + d + 1;
      }
    }
    return { data, dims: [texts.length, dims] };
  });
}

describe("createTransformersEmbedQuery", () => {
  beforeEach(() => {
    pipelineMock.mockReset();
  });

  it("loads the default model and dtype lazily, only on first call", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery, DEFAULT_TRANSFORMERS_MODEL } =
      await import("../src/transformers-embed.js");
    const { embed } = createTransformersEmbedQuery();
    expect(pipelineMock).not.toHaveBeenCalled();

    await embed("hello");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      DEFAULT_TRANSFORMERS_MODEL,
      { dtype: "q8" },
    );
  });

  it("passes through an explicit model and dtype", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = createTransformersEmbedQuery({
      model: "some/model",
      dtype: "fp32",
    });
    await embed("hello");

    expect(pipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      "some/model",
      {
        dtype: "fp32",
      },
    );
  });

  it("reports a provider matching the requested model", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery } = await import(
      "../src/transformers-embed.js"
    );
    const { provider } = createTransformersEmbedQuery({ model: "a/b" });

    expect(provider).toEqual({ type: "local-model", model: "a/b" });
  });

  it("loads the model only once across repeated calls", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = createTransformersEmbedQuery();
    await embed("first");
    await embed("second");
    await embed("third");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenCalledTimes(3);
  });

  it("embeds the query as a single-element batch, mean-pooled and normalized", async () => {
    const extractor = fakeExtractor(3);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = createTransformersEmbedQuery();
    await embed("hello");

    expect(extractor).toHaveBeenCalledWith(["hello"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it("returns the single embedded vector, sliced to the model's dims", async () => {
    const extractor = fakeExtractor(4);
    pipelineMock.mockResolvedValue(extractor);

    const { createTransformersEmbedQuery } = await import(
      "../src/transformers-embed.js"
    );
    const { embed } = createTransformersEmbedQuery();
    const vector = await embed("hello");

    expect(vector).toEqual([1, 2, 3, 4]);
  });
});

/**
 * Real, non-mocked run against the actual Hugging Face Hub -- requires
 * network access to huggingface.co (blocked in this project's own CI
 * sandbox and some contributors' environments), so it's opt-in only.
 * Run with: CSF_TEST_REAL_TRANSFORMERS=1 pnpm --filter @ktjn/searchable-client test
 */
describe.skipIf(!process.env.CSF_TEST_REAL_TRANSFORMERS)(
  "createTransformersEmbedQuery (real model, opt-in)",
  () => {
    it("embeds real text into a 384-dim normalized vector", async () => {
      vi.doUnmock("@huggingface/transformers");
      vi.resetModules();
      const { createTransformersEmbedQuery } = await import(
        "../src/transformers-embed.js"
      );
      const { embed } = createTransformersEmbedQuery();
      const vector = await embed("hello world");

      expect(vector).toHaveLength(384);
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1, 2);
    }, 120_000);
  },
);
