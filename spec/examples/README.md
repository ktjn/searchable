# Reference index generators

Two independent, from-scratch, ~100-line generators proving the index
format ([../schema/](../schema/), [docs/concepts/index-format.md](../../docs/concepts/index-format.md))
needs no library beyond a JSON encoder — see
[Architecture](../../docs/concepts/architecture.md).

Neither generator shares any code with `@csf/indexer` (the real
reference indexer) or with each other. Both take the same input shape
(a JSON array of `{id, url, title, body}`) and use the same simplified
tokenization (lowercase, strip `<tags>`, split on `[a-z0-9]+`) so their
output can be compared directly.

## Usage

```sh
node --experimental-strip-types typescript/generate-index.ts documents.json out-ts/
python3 python/generate_index.py documents.json out-py/
```

## Verified conformance

Running both against [`documents.json`](documents.json) and comparing
output (ignoring `buildId`/content-hash filenames, which are expected to
differ) confirms: identical term set, identical postings for every
term, identical doc store. This is the concrete proof behind the claim
in [Index format](../../docs/concepts/index-format.md) —
the format itself doesn't secretly assume TypeScript, Node, or this
project's own tooling.

Note what this does and doesn't prove: it shows the *format* is
language-agnostic when both sides agree on tokenization. It does not
by itself prove `@csf/indexer`'s real analysis pipeline
([`@csf/analysis`](../../packages/analysis), `Intl.Segmenter`-based) is
reproducible in Python — languages are free to implement a
`LanguageProfile` differently, and correctness there is about
consistency *within* one implementation between index-time and
query-time, not bit-identical tokenization across every possible
implementation.

The stronger "does a real index built by an independent generator load
and query correctly through `@csf/client`" claim
([Project governance](../../docs/project/governance.md#testing)'s
"Cross-implementation conformance" bullet, a Phase 0/7 deliverable) is
now built:
[`packages/client/test/cross-implementation-conformance.test.ts`](../../packages/client/test/cross-implementation-conformance.test.ts)
shells out to `python3 python/generate_index.py` as a subprocess,
serves its output over real HTTP, and runs the same `SearchClient`
query assertions against it as against a `@csf/indexer`-built index of
the same `documents.json` fixture — same expected matching doc ids for
the same query text (not identical scores; the two implementations'
tokenization deliberately differs, per the note above). This fixture's
text is deliberately chosen so its key query words (`"support"`,
`"small"`, `"about"`) stem to themselves under `@csf/analysis`'s Porter
stemmer, since `@csf/client`'s query analysis always applies the real
stemmer regardless of which backend built the index being queried —
a word that stems differently from its own surface form would produce
a different lookup key against the Python generator's literal
(unstemmed) term dictionary than against the real indexer's stemmed
one, which is a tokenization-difference artifact, not a conformance
failure.
