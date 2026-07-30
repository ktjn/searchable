from pathlib import Path

from searchable_client import SearchClient, SearchOptions
from tests.fixtures.build_index import write_index_with_synonyms


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
