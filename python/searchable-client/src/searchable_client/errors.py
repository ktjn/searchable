class SearchClientError(ValueError):
    """Common public base for every searchable-client runtime error."""


class VectorSearchNotConfiguredError(SearchClientError):
    """Raised when vector or hybrid search has no injected query embedder."""


class VectorProviderMismatchError(SearchClientError):
    """Raised when the query embedder provider differs from the index provider."""


class VectorDimensionMismatchError(SearchClientError):
    """Raised when an embedding does not have the index's configured dimensions."""


class VectorUnavailableError(SearchClientError):
    """Raised when the requested language/index has no vector shard."""


class InvalidVectorShardError(SearchClientError):
    """Raised when vector shard data violates the vector search contract."""
