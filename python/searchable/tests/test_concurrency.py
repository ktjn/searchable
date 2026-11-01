"""Concurrency characterization (system-spec Level 2/3 `req-concurrency`).

Nothing else in the suite exercises many in-flight queries against one
shared SearchClient from multiple threads at once -- the real-world
concurrency risk for a backend-service use of this client (README: "or by
the searchable Python client for CLI and backend-service use"), where one
process reuses a single client across concurrent request-handler threads,
all sharing the same ShardCache. This builds one real index with a unique
term per document, then has many threads each search for a different
document's unique term at once, asserting each gets back exactly its own
result -- no cross-contamination through the shared cache.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from searchable.client.client import SearchClient
from searchable.client.types import SearchOptions
from searchable.indexer.build_index import build_index
from searchable.indexer.types import SourceDocument
from searchable.indexer.write_index import write_index

DOC_COUNT = 20


def _doc(doc_id: int) -> SourceDocument:
    html = (
        f"<html lang='en'><head><title>Doc {doc_id}</title></head>"
        f"<body><main><p>widget uniqueterm{doc_id}</p></main></body></html>"
    )
    return SourceDocument(id=doc_id, url=f"/doc-{doc_id}", html=html)


def _write_index(tmp_path: Path) -> str:
    sources = [_doc(doc_id) for doc_id in range(1, DOC_COUNT + 1)]
    built = build_index(sources)
    write_index(built, str(tmp_path))
    return str(tmp_path / "manifest.json")


def test_many_threads_querying_one_client_each_get_exactly_their_own_hit(tmp_path: Path):
    manifest_url = _write_index(tmp_path)
    client = SearchClient(manifest_url)

    def query(doc_id: int) -> tuple[int, list[int]]:
        result = client.search(f"uniqueterm{doc_id}")
        return doc_id, [hit.id for hit in result.hits]

    with ThreadPoolExecutor(max_workers=DOC_COUNT) as pool:
        outcomes = list(pool.map(query, range(1, DOC_COUNT + 1)))

    for doc_id, hit_ids in outcomes:
        assert hit_ids == [doc_id]


def test_a_broad_query_racing_many_narrow_queries_still_sees_every_doc(tmp_path: Path):
    manifest_url = _write_index(tmp_path)
    client = SearchClient(manifest_url)

    def narrow(doc_id: int) -> list[int]:
        return [hit.id for hit in client.search(f"uniqueterm{doc_id}").hits]

    def broad() -> list[int]:
        options = SearchOptions(limit=DOC_COUNT)
        return sorted(hit.id for hit in client.search("widget", options).hits)

    with ThreadPoolExecutor(max_workers=DOC_COUNT + 1) as pool:
        broad_future = pool.submit(broad)
        narrow_futures = [pool.submit(narrow, doc_id) for doc_id in range(1, DOC_COUNT + 1)]
        broad_hits = broad_future.result()
        narrow_hits = [f.result() for f in narrow_futures]

    assert broad_hits == list(range(1, DOC_COUNT + 1))
    for doc_id, hits in zip(range(1, DOC_COUNT + 1), narrow_hits, strict=True):
        assert hits == [doc_id]
