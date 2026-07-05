# Reference index generators

Two independent, from-scratch, ~100-line generators proving the index
format ([../schema/](../schema/), [docs/02-index-format.md](../../docs/02-index-format.md))
needs no library beyond a JSON encoder — see
[docs/20-tech-stack.md](../../docs/20-tech-stack.md#reference-index-generators-python-and-typescript).

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
in [docs/02-index-format.md](../../docs/02-index-format.md#the-format-is-a-spec-not-a-library-dependency) —
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
implementation. The stronger "does a real index built by an independent
generator load and query correctly through `@csf/client`" test is
tracked in [docs/10-testing-and-performance.md](../../docs/10-testing-and-performance.md#1-correctness-tests)
as a Phase 0/7 deliverable, not claimed as already done here.
