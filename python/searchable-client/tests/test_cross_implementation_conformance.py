"""Cross-implementation conformance: proves `SearchClient` returns equivalent
results whether the index it queries was built by the real
`python/searchable-indexer` reference indexer or by the independent,
from-scratch `spec/examples/python/generate_index.py` reference generator
(no shared code -- see spec/examples/README.md), for the same underlying
corpus and the same queries.

Originally this suite was meant to cross-check `searchable-indexer` against
the TypeScript reference indexer (`@ktjn/searchable-indexer`,
`packages/indexer`). That package -- and the TS-side test that once compared
against it, `packages/client/test/cross-implementation-conformance-python-
indexer.test.ts` -- no longer exist: they were deliberately deleted in commit
90c5431 ("Remove TypeScript index generation, Python is now the sole
generator", #61), which made Python the *only* index generator in this repo.
There is no TS indexer left to invoke.

The TS client's own analogous suite,
`packages/client/test/cross-implementation-conformance.test.ts`, hit this
exact wall first and was already retargeted onto a same-language,
independent-implementation comparison: the real `searchable-indexer` vs.
`spec/examples/python/generate_index.py`, a deliberately from-scratch,
non-stemming, no-library generator that shares no code with
`searchable-indexer`. This suite mirrors that same, still-current pattern for
the Python client rather than reintroducing removed TS code.

See `tests/fixtures/conformance_corpus.py` for why the query list below is
restricted to words that stem to themselves.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from searchable_client import SearchClient
from tests.fixtures.conformance_corpus import docs_as_json, write_html_corpus

REPO_ROOT = Path(__file__).resolve().parents[3]


def _build_with_python_indexer(input_dir: Path, out_dir: Path) -> None:
    subprocess.run(
        ["uv", "run", "searchable-indexer", str(input_dir), str(out_dir)],
        cwd=REPO_ROOT / "python" / "searchable-indexer",
        check=True,
        capture_output=True,
        text=True,
    )


def _build_with_reference_generator(documents_json: Path, out_dir: Path) -> None:
    script = REPO_ROOT / "spec" / "examples" / "python" / "generate_index.py"
    if not script.exists():
        pytest.skip(f"independent reference generator not found at {script}")
    subprocess.run(
        [sys.executable, str(script), str(documents_json), str(out_dir)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


QUERIES = ["widget", "gadget", "wid*", "nonexistent"]


@pytest.mark.parametrize("query", QUERIES)
def test_python_client_matches_across_both_index_generators(tmp_path: Path, query: str):
    html_input_dir = tmp_path / "html-input"
    write_html_corpus(html_input_dir)

    documents_json = tmp_path / "documents.json"
    documents_json.write_text(json.dumps(docs_as_json()))

    real_out = tmp_path / "real-index"
    ref_out = tmp_path / "ref-index"
    _build_with_python_indexer(html_input_dir, real_out)
    _build_with_reference_generator(documents_json, ref_out)

    real_client = SearchClient(str(real_out / "manifest.json"))
    ref_client = SearchClient(str(ref_out / "manifest.json"))

    real_result = real_client.search(query)
    ref_result = ref_client.search(query)

    # Hit ids are compared as a SET, not an ordered list: ranking order is
    # deliberately NOT asserted here. `searchable-indexer` builds its index
    # with non-uniform field boosts (`_DEFAULT_FIELD_BOOSTS = {"title": 3.0,
    # "body": 1.0}` in build_index.py), while
    # `spec/examples/python/generate_index.py` is a from-scratch, no-shared-code
    # generator that uses uniform boosts (both fields weighted equally). That
    # difference means the two backends' BM25F scores -- and therefore hit
    # order -- can legitimately diverge even when both return the exact same
    # set of matching documents. Asserting order equality here would be
    # asserting a coincidence of these two particular scoring configurations,
    # not a real conformance guarantee, so it's intentionally out of scope for
    # this suite. (This mirrors why facet-count parity is also not asserted
    # below: it isn't a meaningful comparison for what these two generators
    # actually produce.)
    assert {h.id for h in real_result.hits} == {h.id for h in ref_result.hits}, (
        f"query {query!r}: searchable-indexer result {[h.id for h in real_result.hits]} != "
        f"independent-generator result {[h.id for h in ref_result.hits]}"
    )
    assert real_result.total_hits == ref_result.total_hits

    # Bonus: for queries where at most one document matches, "ranking order"
    # is trivially well-defined (a list of length <= 1 has only one possible
    # order), so the boost-mismatch concern above doesn't apply and we CAN
    # assert full ordered-hit-list equality without asserting anything
    # coincidental. "gadget" only ever matches doc 0 (see
    # tests/fixtures/conformance_corpus.py's DOCS) and "nonexistent" matches
    # nothing, so both queries hit this case.
    if len(real_result.hits) <= 1:
        assert [h.id for h in real_result.hits] == [h.id for h in ref_result.hits]
