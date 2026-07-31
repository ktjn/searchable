# searchable-client (Python)

Python search client for Searchable — the CLI/services counterpart to
`@ktjn/searchable-client` (which targets Node and the browser). Reads the
same manifest/shard JSON (and binary) format; see
`docs/reference/client-api.md` for the shared query model and
`docs/concepts/architecture.md` for how this fits alongside the Python
index generator (`searchable-indexer`) and the TypeScript client.

Vector and hybrid search are supported through the library API. The client
does not bundle an embedding model: inject `embed_query(text) -> list[float]`
when constructing `SearchClient`, optionally with a provider descriptor for
compatibility validation.

```python
from searchable_client import SearchClient
from searchable_client.search import SearchOptions

client = SearchClient(
    "./public-search/manifest.json",
    embed_query={
        "embed": lambda text: application_embed(text),
        "provider": {"type": "custom"},
    },
)
result = client.search("semantic query", SearchOptions(mode="hybrid"))
```

The CLI remains lexical-only because it has no transport-neutral way to
receive an application embedding function. No Transformers, NumPy, or model
runtime is required by this package.
