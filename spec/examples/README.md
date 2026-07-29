# Reference index generator

A simple, from-scratch, ~100-line Python generator proving the index
format ([../schema/](../schema/), [docs/concepts/index-format.md](../../docs/concepts/index-format.md))
needs no library beyond a JSON encoder — see
[Architecture](../../docs/concepts/architecture.md).

This generator shares no code with `searchable-indexer`
(`python/searchable-indexer`, the real index generator). It takes the input
shape (a JSON array of `{id, url, title, body}`) and uses simplified
tokenization (lowercase, strip `<tags>`, split on `[a-z0-9]+`) to
demonstrate that the index format itself requires nothing more than a
JSON encoder.

## Usage

```sh
python3 python/generate_index.py documents.json out-py/
```
