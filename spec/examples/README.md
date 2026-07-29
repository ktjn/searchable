# Reference index generator

A simple, from-scratch, ~100-line Python generator proving the index
format ([../schema/](../schema/), [docs/concepts/index-format.md](../../docs/concepts/index-format.md))
needs no library beyond a JSON encoder — see
[Architecture](../../docs/concepts/architecture.md).

This generator shares no code with `@ktjn/searchable-indexer` (the real
reference indexer). It takes the input shape
(a JSON array of `{id, url, title, body}`) and uses simplified
tokenization (lowercase, strip `<tags>`, split on `[a-z0-9]+`).

## Usage

```sh
python3 python/generate_index.py documents.json out-py/
```

## Verified conformance

The index format's language-agnostic nature is verified through the
cross-implementation conformance test:
[`packages/client/test/cross-implementation-conformance.test.ts`](../../packages/client/test/cross-implementation-conformance.test.ts)
shells out to `python3 python/generate_index.py` as a subprocess,
serves its output over real HTTP, and runs the same `SearchClient`
query assertions against it as against a `@ktjn/searchable-indexer`-built index of
the same `documents.json` fixture — same expected matching doc ids for
the same query text (not identical scores; the two implementations'
tokenization deliberately differs). This fixture's text is deliberately
chosen so its key query words (`"support"`, `"small"`, `"about"`) stem
to themselves under `@ktjn/searchable-analysis`'s Porter stemmer, since
`@ktjn/searchable-client`'s query analysis always applies the real
stemmer regardless of which backend built the index being queried —
a word that stems differently from its own surface form would produce
a different lookup key against the Python generator's literal
(unstemmed) term dictionary than against the real indexer's stemmed
one, which is a tokenization-difference artifact, not a conformance
failure.
