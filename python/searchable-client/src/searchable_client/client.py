import warnings
from collections.abc import Callable, Iterable, Iterator, Mapping
from typing import Any

from searchable_client.errors import (
    VectorDimensionMismatchError,
    VectorProviderMismatchError,
    VectorSearchNotConfiguredError,
    VectorUnavailableError,
)
from searchable_client.fetch import ShardCache
from searchable_client.search import (
    FacetResult,
    FacetValuesOptions,
    Hit,
    SearchOptions,
    SearchResult,
    facet_values,
    retrieve,
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
        self,
        index_url: str,
        *,
        allow_cross_origin_shards: bool = False,
        strict: bool = False,
        embed_query: Callable[[str], list[float]] | Mapping[str, Any] | None = None,
        validate_vector_provider: bool = True,
    ) -> None:
        self._index_url = _to_absolute_url(index_url)
        self._cache = ShardCache()
        self._allow_cross_origin_shards = allow_cross_origin_shards
        self._strict = strict
        self._embed_query, self._embed_provider = self._normalize_embed_query(embed_query)
        self._validate_vector_provider = validate_vector_provider
        self._manifest = validate_manifest(
            self._cache.fetch_json(self._index_url),
            self._index_url,
            allow_cross_origin_shards=allow_cross_origin_shards,
            strict=strict,
        )

    def search(self, query: str, options: SearchOptions | None = None) -> SearchResult:
        options = options or SearchOptions()
        query_vector = self._query_vector(query, options)
        return search(
            query,
            self._manifest,
            self._cache,
            self._index_url,
            options,
            query_vector=query_vector,
        )

    @staticmethod
    def _normalize_embed_query(
        embed_query: Callable[[str], list[float]] | Mapping[str, Any] | None,
    ) -> tuple[Callable[[str], list[float]] | None, dict[str, Any] | None]:
        if embed_query is None:
            return None, None
        if callable(embed_query):
            return embed_query, None
        embed = embed_query.get("embed")
        if not callable(embed):
            raise TypeError("embed_query mapping must contain a callable 'embed'")
        provider = embed_query.get("provider")
        if provider is not None and not isinstance(provider, dict):
            raise TypeError("embed_query provider must be a dictionary when supplied")
        return embed, provider

    def _query_vector(self, query: str, options: SearchOptions) -> list[float] | None:
        if options.mode not in ("lexical", "vector", "hybrid"):
            raise ValueError(f"unsupported search mode {options.mode!r}")
        if options.mode == "lexical":
            return None
        if self._embed_query is None:
            raise VectorSearchNotConfiguredError(
                f'SearchClient.search: mode "{options.mode}" requires embed_query'
            )
        vectors = self._manifest.vectors
        language = options.language or self._manifest.default_language
        if vectors is None or language not in vectors.shards:
            raise VectorUnavailableError(
                f'SearchClient.search: mode "{options.mode}" requires vectors and a vector '
                "shard for "
                f'language {language!r}'
            )
        if self._validate_vector_provider and self._embed_provider is not None:
            if self._embed_provider != vectors.embedding_provider:
                raise VectorProviderMismatchError(
                    "SearchClient.search: embed_query provider "
                    f"{self._embed_provider!r} does not match index provider "
                    f"{vectors.embedding_provider!r}"
                )
        raw_vector = self._embed_query(query)
        if not isinstance(raw_vector, list) or not all(
            isinstance(value, (int, float)) and not isinstance(value, bool)
            for value in raw_vector
        ):
            raise VectorDimensionMismatchError("embed_query must return a list of numbers")
        if len(raw_vector) != vectors.dims:
            raise VectorDimensionMismatchError(
                f"embed_query returned {len(raw_vector)} dimensions; index requires "
                f"{vectors.dims}"
            )
        return [float(value) for value in raw_vector]

    def search_stream(
        self, query: str, options: SearchOptions | None = None
    ) -> Iterator[SearchResult]:
        yield from search_stream(query, self._manifest, self._cache, self._index_url, options)

    def facet_values(self, field: str, options: FacetValuesOptions | None = None) -> FacetResult:
        return facet_values(field, self._manifest, self._cache, self._index_url, options)

    def get_documents(self, ids: Iterable[int]) -> list[Hit]:
        return retrieve(ids, self._manifest, self._cache, self._index_url)

    def retrieve(self, ids: Iterable[int]) -> list[Hit]:
        warnings.warn(
            "SearchClient.retrieve() is deprecated; use get_documents() instead",
            DeprecationWarning,
            stacklevel=2,
        )
        return self.get_documents(ids)
