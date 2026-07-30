# searchable-client (Python)

Python search client for Searchable — the CLI/services counterpart to
`@ktjn/searchable-client` (which targets Node and the browser). Reads the
same manifest/shard JSON (and binary) format; see
`docs/reference/client-api.md` for the shared query model and
`docs/concepts/architecture.md` for how this fits alongside the Python
index generator (`searchable-indexer`) and the TypeScript client.

Vector/hybrid search is not supported (tracked as a future addition
alongside vector support landing in the Python indexer).
