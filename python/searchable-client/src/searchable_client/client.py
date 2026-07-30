from collections.abc import Iterator

from searchable_client.fetch import ShardCache
from searchable_client.search import (
    FacetResult,
    FacetValuesOptions,
    SearchOptions,
    SearchResult,
    facet_values,
    search,
    search_stream,
)
from searchable_client.validate_manifest import validate_manifest


def _to_absolute_url(index_url: str) -> str:
    import urllib.parse
    from pathlib import Path

    parsed = urllib.parse.urlparse(index_url)
    if parsed.scheme in ("http", "https", "file"):
        return index_url
    return Path(index_url).resolve().as_uri()


class SearchClient:
    def __init__(
        self, index_url: str, *, allow_cross_origin_shards: bool = False, strict: bool = False
    ) -> None:
        self._index_url = _to_absolute_url(index_url)
        self._cache = ShardCache()
        self._allow_cross_origin_shards = allow_cross_origin_shards
        self._strict = strict
        self._manifest = validate_manifest(
            self._cache.fetch_json(self._index_url),
            self._index_url,
            allow_cross_origin_shards=allow_cross_origin_shards,
            strict=strict,
        )

    def search(self, query: str, options: SearchOptions | None = None) -> SearchResult:
        return search(query, self._manifest, self._cache, self._index_url, options)

    def search_stream(
        self, query: str, options: SearchOptions | None = None
    ) -> Iterator[SearchResult]:
        yield from search_stream(query, self._manifest, self._cache, self._index_url, options)

    def facet_values(self, field: str, options: FacetValuesOptions | None = None) -> FacetResult:
        return facet_values(field, self._manifest, self._cache, self._index_url, options)
