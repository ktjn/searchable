import json
from pathlib import Path

import pytest

from searchable_client import SearchClient, SearchOptions
from tests.fixtures.build_index import write_index_with_synonyms


def _write_structured_index(out_dir: Path) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir()
    (out_dir / "docs").mkdir()
    (out_dir / "terms" / "all.json").write_text(
        '{"chunk": {"df": 2, "postings": [{"doc": 1, "fields": '
        '{"body": {"tf": 1, "pos": [0], "len": 1}}}, {"doc": 2, '
        '"fields": {"body": {"tf": 1, "pos": [0], "len": 1}}}]}}'
    )
    (out_dir / "docs" / "0.json").write_text(
        '{"1": {"url": "/one", "fields": {"body": "chunk one"}, '
        '"externalId": "source-one", "metadata": {"chunkIndex": 1}, '
        '"contentHash": "sha256:one"}, '
        '"2": {"url": "/two", "fields": {"body": "chunk two"}, '
        '"externalId": "source-two", "metadata": {"chunkIndex": 2}, '
        '"contentHash": "sha256:two"}}'
    )
    manifest = {
        "version": 1,
        "buildId": "structured-test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"body": {"indexed": True, "stored": True, "boost": 1.0}},
        "docCount": {"en": 2},
        "avgFieldLength": {"en": {"body": 1.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json"}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def test_client_search_reads_manifest_and_returns_hits(tmp_path: Path):
    manifest_url = write_index_with_synonyms(tmp_path / "idx")
    client = SearchClient(manifest_url)
    result = client.search("sofa")
    assert [h.id for h in result.hits] == [1]


def test_client_search_stream_yields_generator(tmp_path: Path):
    manifest_url = write_index_with_synonyms(tmp_path / "idx")
    client = SearchClient(manifest_url)
    results = list(client.search_stream("sofa", SearchOptions(synonyms=True)))
    assert len(results) == 2


def test_client_facet_values(tmp_path: Path):
    from tests.fixtures.build_index import write_index_with_category_facet

    manifest_url = write_index_with_category_facet(tmp_path / "idx")
    client = SearchClient(manifest_url)
    result = client.facet_values("category")
    assert {v.value for v in result.values} == {"red", "blue"}


def test_client_accepts_bare_filesystem_path_not_just_file_uri(tmp_path: Path):
    from tests.fixtures.build_index import write_basic_index

    write_basic_index(tmp_path / "idx")
    bare_path = str(tmp_path / "idx" / "manifest.json")
    client = SearchClient(bare_path)
    result = client.search("widget")
    assert result.total_hits == 2
    legacy_documents = client.get_documents([2, 1])
    assert [hit.id for hit in legacy_documents] == [2, 1]
    assert legacy_documents[0].external_id is None
    assert legacy_documents[0].metadata is None
    assert legacy_documents[0].content_hash is None


def test_client_retrieve_returns_structured_documents_in_requested_order(tmp_path: Path):
    client = SearchClient(_write_structured_index(tmp_path / "idx"))

    hits = client.get_documents([2, 999, 1])

    assert [hit.id for hit in hits] == [2, 1]
    assert hits[0].external_id == "source-two"
    assert hits[0].metadata == {"chunkIndex": 2}
    assert hits[0].content_hash == "sha256:two"
    assert hits[0].score == 0.0


def test_client_retrieve_alias_is_deprecated_but_compatible(tmp_path: Path):
    client = SearchClient(_write_structured_index(tmp_path / "idx"))

    with pytest.warns(DeprecationWarning, match="get_documents"):
        hits = client.retrieve([1])

    assert [hit.id for hit in hits] == [1]


def test_client_search_exposes_structured_hit_fields(tmp_path: Path):
    client = SearchClient(_write_structured_index(tmp_path / "idx"))

    hit = client.search("chunk").hits[0]

    assert hit.external_id == "source-one"
    assert hit.metadata == {"chunkIndex": 1}
    assert hit.content_hash == "sha256:one"
