# Python Vector and Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dependency-light vector and hybrid query support to the Python `searchable-client` using an injected query embedder and the existing Searchable vector-shard contract.

**Architecture:** Mirror the stable TypeScript vector primitives in a focused Python `vectors.py` module. Extend manifest and query option models, then keep lexical search intact while composing vector-only and hybrid retrieval around the existing document-store and lexical result paths. Provider metadata is caller-supplied and validated structurally; no embedding runtime is added.

**Tech Stack:** Python 3.10+, dataclasses, pytest, mypy, Ruff, uv/Hatch, existing Searchable JSON index format, GitHub Actions/PyPI release workflow.

## Global Constraints

- Runtime dependencies remain limited to `searchable-analysis`; do not add Transformers, NumPy, SciPy, or a network client.
- Query embeddings are supplied by `embed_query(text) -> list[float]`, optionally paired with a JSON-compatible provider descriptor.
- Vector dimensions are corpus-wide and must exactly match the query vector.
- Int8 vectors use the existing shared shard `quantRange` scaling contract; float32 vectors pass through unchanged.
- Vector search is brute-force and keeps only the best passage per document.
- Hybrid search defaults to RRF with `k=60`; optional `vector_weight` retains TypeScript parity.
- Every production change must be preceded by a failing focused test and verified with the affected Python tests.
- Existing lexical, binary-shard, schema, conformance, lint, and mypy gates must remain green.

---

### Task 1: Add vector models, parsing, and scoring primitives

**Files:**
- Create: `python/searchable-client/src/searchable_client/vectors.py`
- Modify: `python/searchable-client/src/searchable_client/types.py`
- Test: `python/searchable-client/tests/test_vectors.py`
- Test: `python/searchable-client/tests/test_types.py`

**Interfaces:**
- Produces `VectorManifest`, `VectorShard`, `VectorEntry`, `VectorHit`, `dequantize_vector`, `cosine_similarity`, `brute_force_vector_search`, and `reciprocal_rank_fusion`.
- `VectorManifest` contains `dims: int`, `quantization: str`, `embedding_provider: dict[str, object]`, and `shards: dict[str, str]`.
- `VectorShard` contains `dims`, `quantization`, optional `quant_range: tuple[float, float]`, and entries with `passage_id`, `doc_id`, and `vector`.

- [ ] **Step 1: Write failing vector primitive tests**

```python
def test_dequantize_int8_uses_shared_shard_range():
    shard = VectorShard(dims=2, quantization="int8", quant_range=(10.0, 20.0), entries=[])
    assert dequantize_vector([0, 128, 255], shard) == pytest.approx([10.0, 15.0196078, 20.0])

def test_cosine_similarity_returns_zero_for_zero_vector():
    assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0

def test_vector_search_keeps_best_passage_per_document():
    shard = fixture_shard_with_two_passages_for_doc_one()
    hits = brute_force_vector_search([1.0, 0.0], shard, limit=10)
    assert [(hit.doc_id, hit.passage_id) for hit in hits] == [(1, "1-1"), (2, "2-0")]

def test_rrf_sums_one_based_reciprocal_ranks():
    fused = reciprocal_rank_fusion([[1, 2], [2, 3]], k=60)
    assert fused[2] == pytest.approx(1 / 61 + 1 / 62)
```

- [ ] **Step 2: Run the focused tests and verify they fail because the vector module and types do not exist**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vectors.py -q`

Expected: collection/import failure naming the missing vector interfaces.

- [ ] **Step 3: Add typed vector dataclasses and manifest conversion**

Add `vectors` to `Manifest` and parse `data["vectors"]` into a `VectorManifest`, preserving camelCase wire keys and rejecting missing required metadata with the same direct `KeyError`/validation style used by existing shard parsers.

- [ ] **Step 4: Implement the minimal vector primitives**

Implement dequantization as `min + (raw / 255) * (max - min)`, cosine as dot product divided by both Euclidean norms with zero-norm result `0.0`, best-per-document collapse before sorting/truncating, and RRF as the sum of `1 / (k + one_based_rank)`.

- [ ] **Step 5: Run the focused tests and then type/lint the changed modules**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vectors.py python/searchable-client/tests/test_types.py -q`

Run: `uv run --project python/searchable-client ruff check src/searchable_client/vectors.py src/searchable_client/types.py tests/test_vectors.py tests/test_types.py`

Expected: all focused tests pass and Ruff reports no errors.

- [ ] **Step 6: Commit the primitive slice**

```bash
git add python/searchable-client/src/searchable_client/vectors.py python/searchable-client/src/searchable_client/types.py python/searchable-client/tests/test_vectors.py python/searchable-client/tests/test_types.py
git commit -m "feat(python): add vector scoring primitives"
```

### Task 2: Add explicit vector errors and SearchClient embedding configuration

**Files:**
- Create: `python/searchable-client/src/searchable_client/errors.py`
- Modify: `python/searchable-client/src/searchable_client/client.py`
- Modify: `python/searchable-client/src/searchable_client/search.py`
- Modify: `python/searchable-client/src/searchable_client/__init__.py`
- Test: `python/searchable-client/tests/test_vector_errors.py`
- Test: `python/searchable-client/tests/test_client.py`

**Interfaces:**
- Produces public `VectorSearchNotConfiguredError`, `VectorProviderMismatchError`, `VectorDimensionMismatchError`, `VectorUnavailableError`, and `InvalidVectorShardError`.
- `SearchClient(..., embed_query=None, validate_vector_provider=True)` stores either a callable or `{ "embed": callable, "provider": dict }`.
- `SearchOptions` gains `mode: str = "lexical"` and `vector_weight: float | None = None`.

- [ ] **Step 1: Write failing configuration and error tests**

```python
def test_vector_mode_without_embedder_raises_explicit_error(client):
    with pytest.raises(VectorSearchNotConfiguredError, match="embed_query"):
        client.search("semantic query", SearchOptions(mode="vector"))

def test_vector_mode_without_index_vectors_raises_explicit_error(client_without_vectors):
    configured = SearchClient(client_without_vectors.index_url, embed_query=lambda _: [1.0])
    with pytest.raises(VectorUnavailableError, match="vectors"):
        configured.search("query", SearchOptions(mode="vector"))

def test_provider_mismatch_fails_before_embedding(provider_index):
    called = False

    def embed(_: str) -> list[float]:
        nonlocal called
        called = True
        return [1.0, 0.0]

    client = SearchClient(
        provider_index,
        embed_query={"embed": embed, "provider": {"type": "local-model", "model": "other"}},
    )
    with pytest.raises(VectorProviderMismatchError):
        client.search("query", SearchOptions(mode="vector"))
    assert called is False
```

- [ ] **Step 2: Run the tests and verify each fails for the missing public API/behavior**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vector_errors.py python/searchable-client/tests/test_client.py -q`

Expected: import or assertion failures because options, constructor arguments, and errors are not implemented.

- [ ] **Step 3: Implement public error classes and embedder normalization**

Create named `ValueError` subclasses with stable messages. Normalize a bare callable to an unvalidated embedder and a mapping to its callable plus optional provider. Validate that the mapping has a callable `embed` and reject invalid `mode`, negative limits, invalid `vector_weight`, and malformed provider configuration with clear `ValueError` messages.

- [ ] **Step 4: Implement vector request preflight**

Before calling the embedder, require a configured embedder, require `manifest.vectors`, require a shard file for the selected language, compare a declared provider structurally to `embedding_provider` when validation is enabled, call the embedder exactly once, and reject non-list/non-numeric/non-finite or wrong-dimensional vectors with `VectorDimensionMismatchError` or `InvalidVectorShardError`.

- [ ] **Step 5: Run focused tests and mypy**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vector_errors.py python/searchable-client/tests/test_client.py -q`

Run: `uv run --project python/searchable-client mypy`

Expected: focused tests pass; mypy has no new errors.

- [ ] **Step 6: Commit the configuration/error slice**

```bash
git add python/searchable-client/src/searchable_client/errors.py python/searchable-client/src/searchable_client/client.py python/searchable-client/src/searchable_client/search.py python/searchable-client/src/searchable_client/__init__.py python/searchable-client/tests/test_vector_errors.py python/searchable-client/tests/test_client.py
git commit -m "feat(python): validate vector query configuration"
```

### Task 3: Integrate vector-only and hybrid retrieval

**Files:**
- Modify: `python/searchable-client/src/searchable_client/search.py`
- Modify: `python/searchable-client/src/searchable_client/client.py`
- Test: `python/searchable-client/tests/test_vector_search.py`
- Test: `python/searchable-client/tests/test_search_core.py`
- Test: `python/searchable-client/tests/fixtures/build_index.py`

**Interfaces:**
- `search()` accepts the normalized embedder context from `SearchClient` while retaining its existing direct-call signature compatibility.
- Vector-only returns `Hit.score` equal to cosine similarity and one hit per document.
- Hybrid defaults to RRF scores and accepts `vector_weight` for normalized weighted merging.

- [ ] **Step 1: Write failing integration tests against a deterministic fixture**

```python
def test_vector_mode_finds_semantically_related_document(vector_index):
    client = SearchClient(vector_index, embed_query=lambda _: [1.0, 0.0])
    result = client.search("unrelated lexical words", SearchOptions(mode="vector", limit=2))
    assert [hit.id for hit in result.hits] == [2, 1]
    assert len({hit.id for hit in result.hits}) == len(result.hits)

def test_hybrid_uses_rrf_to_combine_lexical_and_vector_rankings(vector_index):
    client = SearchClient(vector_index, embed_query=lambda _: [1.0, 0.0])
    result = client.search("lexical anchor", SearchOptions(mode="hybrid", limit=3))
    assert [hit.id for hit in result.hits] == [1, 2, 3]
    assert result.hits[0].score > 0

def test_vector_shard_malformed_dimensions_raise(vector_index_with_bad_shard):
    client = SearchClient(vector_index_with_bad_shard, embed_query=lambda _: [1.0, 0.0])
    with pytest.raises(InvalidVectorShardError, match="dims"):
        client.search("query", SearchOptions(mode="vector"))
```

- [ ] **Step 2: Run the integration tests and verify they fail because search ignores vector modes**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vector_search.py -q`

Expected: failures showing lexical-only results or unsupported vector behavior.

- [ ] **Step 3: Add vector shard loading and validation to the query path**

Load the language shard through `ShardCache` and `resolve_url`, parse it into `VectorShard`, validate corpus dimensions, quantization metadata, entry dimensions, finite numeric values, and document IDs, then call `brute_force_vector_search`.

- [ ] **Step 4: Add vector-only result assembly**

Use vector hit IDs to load stored documents with `_fetch_doc_store_entries_by_ids`, convert them through the existing `Hit` assembly path, preserve highlights only when requested, and return vector total-hit counts based on candidate documents.

- [ ] **Step 5: Add hybrid fusion and existing query semantics**

Run the existing lexical query to obtain an organic ranked list, independently obtain vector hits, exclude or preserve pinned IDs according to the established behavior, fuse IDs with RRF by default, and use normalized lexical/cosine scores only when `vector_weight` is supplied. Keep filters/facets applied to lexical candidates and ensure the final document lookup happens once.

- [ ] **Step 6: Run the vector and complete Python client suites**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_vector_search.py python/searchable-client/tests/test_search_core.py -q`

Run: `uv run --project python/searchable-client pytest -q`

Expected: all Python client tests pass with no lexical regressions.

- [ ] **Step 7: Commit the query integration slice**

```bash
git add python/searchable-client/src/searchable_client/search.py python/searchable-client/src/searchable_client/client.py python/searchable-client/tests/test_vector_search.py python/searchable-client/tests/test_search_core.py python/searchable-client/tests/fixtures/build_index.py
git commit -m "feat(python): add vector and hybrid query modes"
```

### Task 4: Align exports, CLI surface, documentation, and changelog

**Files:**
- Modify: `python/searchable-client/src/searchable_client/__init__.py`
- Modify: `python/searchable-client/README.md`
- Modify: `docs/reference/python-client-api.md`
- Modify: `docs/concepts/architecture.md`
- Modify: `docs/guides/vector-search.md`
- Modify: `CHANGELOG.md`
- Test: `python/searchable-client/tests/test_public_api.py`

- [ ] **Step 1: Write failing documentation/API smoke tests**

```python
def test_public_package_exports_vector_errors():
    import searchable_client

    assert searchable_client.VectorSearchNotConfiguredError
    assert searchable_client.VectorProviderMismatchError
```

- [ ] **Step 2: Run the smoke test and verify missing exports fail**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_public_api.py -q`

Expected: failure until the public exports and documented API examples are updated.

- [ ] **Step 3: Export the new public types and errors**

Update `__all__` and package imports without exposing internal shard helpers as public API.

- [ ] **Step 4: Update Python usage and vector-search documentation**

Document `SearchClient(embed_query=...)`, provider descriptors, mode selection, RRF behavior, vector limits, explicit errors, and the absence of built-in model dependencies. Replace all lexical-only claims in README/API/architecture docs and link the shared vector-search guide.

- [ ] **Step 5: Update CLI documentation and release notes**

Keep the CLI lexical-only because it has no transport-neutral way to receive an application embedder. Document that vector/hybrid queries are available through the Python library API and that the CLI continues to reject semantic modes by construction rather than silently attempting to create an embedding provider. Add a changelog entry describing the new Python surface and compatibility behavior.

- [ ] **Step 6: Run docs/API tests and commit**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_public_api.py -q`

Run: `git diff --check`

```bash
git add python/searchable-client/src/searchable_client/__init__.py python/searchable-client/README.md docs/reference/python-client-api.md docs/concepts/architecture.md docs/guides/vector-search.md CHANGELOG.md python/searchable-client/tests/test_cli.py
git commit -m "docs: document Python vector and hybrid search"
```

### Task 5: Prepare the minor release and verify PyPI publication artifacts

**Files:**
- Modify: `python/searchable-client/pyproject.toml`
- Modify: `README.md`
- Modify: `docs/project/public-launch-checklist.md`
- Modify: `.github/workflows/publish.yml`
- Test: `python/searchable-client/tests/test_package_metadata.py`

- [ ] **Step 1: Write the failing metadata test**

```python
def test_client_package_metadata_advertises_vector_support():
    text = Path("python/searchable-client/pyproject.toml").read_text()
    assert "vector and hybrid" in text.lower()
    assert "0.2.0" in text
```

- [ ] **Step 2: Run the metadata test and verify it fails against version 0.1.0 and lexical-only description**

Run: `uv run --project python/searchable-client pytest python/searchable-client/tests/test_package_metadata.py -q`

Expected: assertion failure before metadata changes.

- [ ] **Step 3: Bump the Python client minor version and package description**

Set `searchable-client` to `0.2.0`, remove the lexical-only description, and preserve the dependency-free runtime dependency set. Update root release docs to list the Python feature and PyPI package.

- [ ] **Step 4: Verify workflow and artifact configuration**

Inspect the existing release workflow, ensure the Python client artifact is built and uploaded to PyPI using `PYPI_API_TOKEN`, and add no hard-coded credentials or model dependencies. Update the public-launch checklist if its package-release state is now satisfied.

- [ ] **Step 5: Build and inspect the artifact**

Run: `uv build --project python/searchable-client`

Run: `python -m zipfile -l python/searchable-client/dist/searchable_client-0.2.0-py3-none-any.whl`

Expected: wheel and sdist are produced; the wheel contains package sources and excludes caches/tests.

- [ ] **Step 6: Commit release metadata**

```bash
git add python/searchable-client/pyproject.toml README.md docs/project/public-launch-checklist.md .github/workflows/release.yml python/searchable-client/tests/test_package_metadata.py
git commit -m "release(python): publish vector and hybrid search support"
```

### Task 6: Run repository gates and publish

**Files:**
- No planned source changes; only fix files identified by failing verification.

- [ ] **Step 1: Run the complete Python client gate**

Run: `uv run --project python/searchable-client pytest -q`

Run: `uv run --project python/searchable-client ruff check .`

Run: `uv run --project python/searchable-client mypy`

- [ ] **Step 2: Run the repository-required JavaScript checks**

Run: `npx biome check .`

Run: `npx vitest run <affected test files>`

Run: `pnpm test`

- [ ] **Step 3: Inspect the final diff and branch state**

Run: `git diff main...HEAD --stat`

Run: `git diff main...HEAD --check`

Run: `git status --short --branch`

Expected: only intentional feature/docs/release files are committed; unrelated pre-existing untracked files remain untracked.

- [ ] **Step 4: Push and open the release PR after verification**

Push `codex/python-vector-hybrid`, open a PR with the test evidence, and let CI perform the tagged-release publication. Do not claim PyPI publication until the release workflow succeeds and the package can be installed from PyPI.
