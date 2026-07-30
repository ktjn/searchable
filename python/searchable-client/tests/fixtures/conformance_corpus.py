"""A tiny shared corpus for `test_cross_implementation_conformance.py`.

Feeds *two independent index generators* -- the real `python/searchable-indexer`
reference indexer and the independent, from-scratch
`spec/examples/python/generate_index.py` reference generator (which shares no
code with `searchable-indexer`, see spec/examples/README.md) -- with equivalent
content, so a test can prove `searchable_client.SearchClient` gets the same
answers regardless of which one built the index.

There used to be an actual TypeScript indexer (`@ktjn/searchable-indexer`,
`packages/indexer`) to cross-check against here. It was deliberately removed
in commit 90c5431 ("Remove TypeScript index generation, Python is now the sole
generator", #61) -- Python is now the *only* index generator, so there is no
TS side left to build an index with. The TS client's own analogous suite
(`packages/client/test/cross-implementation-conformance.test.ts`) hit the same
wall and was already retargeted from a TS-vs-Python comparison onto a
Python-indexer-vs-independent-Python-generator comparison; this fixture and
its test mirror that same, still-current pattern for the Python client.

Docs are listed here as plain (id, url, title, body) tuples -- the shape
`spec/examples/python/generate_index.py` consumes directly as JSON -- and
`write_html_corpus` derives the on-disk HTML fixture `searchable-indexer`
discovers from the same data, keeping `id`/`url` assignment in lockstep with
`discover_html_documents`'s behavior (sorted-by-filename, 0-based id, url is
"/" + filename stem) so both indexers assign matching doc ids for the same
underlying content.

Query terms are deliberately chosen (as
cross-implementation-conformance.test.ts's docstring explains for its own
fixture) so each word's Porter stem equals its own surface form -- e.g.
"widget", "gadget", not "widgets" -> "widget". `SearchClient`'s query analysis
always runs the real stemmer regardless of which backend built the index, but
only `searchable-indexer` stems *at index build time*; the independent
generator does not. A query word that already equals its own stem is a fair,
meaningful probe of both indexes; one that doesn't would only ever match the
real indexer's stemmed postings.
"""
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Doc:
    id: int
    url: str
    title: str
    body: str


# Sorted by filename stem ("gadget" < "unrelated" < "widget"), matching the
# order `searchable_indexer.discover.discover_html_documents` assigns ids in
# when it walks the input directory.
DOCS = [
    Doc(id=0, url="/gadget", title="Blue Gadget", body="A blue gadget, similar to a widget."),
    Doc(id=1, url="/unrelated", title="Company About Page", body="We make things."),
    Doc(id=2, url="/widget", title="Red Widget", body="A sturdy red widget for home use."),
]


def write_html_corpus(input_dir: Path) -> None:
    """Writes one `<url-stem>.html` file per `DOCS` entry for `searchable-indexer`."""
    input_dir.mkdir(parents=True, exist_ok=True)
    for doc in DOCS:
        stem = doc.url.lstrip("/")
        html = (
            f'<html lang="en"><head><title>{doc.title}</title></head>'
            f"<body><main><p>{doc.body}</p></main></body></html>"
        )
        (input_dir / f"{stem}.html").write_text(html, encoding="utf-8")


def docs_as_json() -> list[dict[str, object]]:
    """Same corpus in the `{id, url, title, body}` shape
    `spec/examples/python/generate_index.py` consumes as `documents.json`."""
    return [{"id": doc.id, "url": doc.url, "title": doc.title, "body": doc.body} for doc in DOCS]
