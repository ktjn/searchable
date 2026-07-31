class VectorSearchNotConfiguredError(ValueError):
    """Raised when vector or hybrid search has no injected query embedder."""


class VectorProviderMismatchError(ValueError):
    """Raised when the query embedder provider differs from the index provider."""


class VectorDimensionMismatchError(ValueError):
    """Raised when an embedding does not have the index's configured dimensions."""


class VectorUnavailableError(ValueError):
    """Raised when the requested language/index has no vector shard."""


class InvalidVectorShardError(ValueError):
    """Raised when vector shard data violates the vector search contract."""
