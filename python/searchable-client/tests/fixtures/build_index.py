"""Hand-builds a minimal JSON-format index directly to disk for search.py unit tests.

No indexer invocation, since these tests exercise the *client's* matching/scoring
logic against a known-shape index, not indexer/client conformance (that's Task 19's
job).
"""
import json
from pathlib import Path


def write_basic_index(out_dir: Path) -> str:
    """Two docs, one field 'title', language 'en'. Returns the manifest file:// URL."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)

    term_shard = {
        "widget": {
            "df": 2,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 2}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}},
            ],
        },
        "red": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))

    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Red Widget"}},
        "2": {"url": "https://example.com/2", "fields": {"title": "Blue Widget"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))

    manifest = {
        "version": 1,
        "buildId": "test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 2},
        "avgFieldLength": {"en": {"title": 2.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_category_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'category' terms facet: doc 1=red, doc 2=blue."""
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)
    facet_shard = {
        "type": "terms",
        "values": {
            "red": {"count": 1, "docs": [1]},
            "blue": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(facet_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "category", "file": "facets/category.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_two_facets(out_dir: Path) -> str:
    """Three docs, one field 'title', language 'en', plus TWO terms facets whose
    matching doc sets are deliberately NOT identical to each other:
    - doc 1: category=red,  stock=in-stock
    - doc 2: category=red,  stock=out-of-stock
    - doc 3: category=blue, stock=in-stock

    All three docs share the term "widget" so all are candidates for that query
    regardless of filters; this lets tests distinguish "exclude the facet's own
    filter from the contextual base set" from "don't exclude it", since
    category=red and stock=in-stock resolve to different doc sets ({1,2} vs {1,3}).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    (out_dir / "facets").mkdir(exist_ok=True)

    term_shard = {
        "widget": {
            "df": 3,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 2}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}},
                {"doc": 3, "fields": {"title": {"tf": 1, "pos": [1], "len": 2}}},
            ],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))

    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Red Widget"}},
        "2": {"url": "https://example.com/2", "fields": {"title": "Red Widget"}},
        "3": {"url": "https://example.com/3", "fields": {"title": "Blue Widget"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))

    manifest = {
        "version": 1,
        "buildId": "test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 3},
        "avgFieldLength": {"en": {"title": 2.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 1}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 3]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    manifest_url = manifest_path.resolve().as_uri()

    category_shard = {
        "type": "terms",
        "values": {
            "red": {"count": 2, "docs": [1, 2]},
            "blue": {"count": 1, "docs": [3]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(category_shard))

    stock_shard = {
        "type": "terms",
        "values": {
            "in-stock": {"count": 2, "docs": [1, 3]},
            "out-of-stock": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "stock.json").write_text(json.dumps(stock_shard))

    manifest["shards"]["facets"] = [
        {"field": "category", "file": "facets/category.json"},
        {"field": "stock", "file": "facets/stock.json"},
    ]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_range_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'price' range facet: doc1=10.0, doc2=50.0."""
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)

    price_shard = {
        "type": "range",
        "values": {
            "0-25": {"count": 1, "docs": [1]},
            "25-75": {"count": 1, "docs": [2]},
        },
        "sorted": [
            {"value": 10.0, "doc": 1},
            {"value": 50.0, "doc": 2},
        ],
    }
    (out_dir / "facets" / "price.json").write_text(json.dumps(price_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "price", "file": "facets/price.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def _add_pins(out_dir: Path, manifest_url: str, pins_shard: dict) -> str:
    """Writes pins.json into an already-built index directory and wires it into the
    manifest's "pins" map for the "en" language. Shared by all pin fixtures below."""
    (out_dir / "pins.json").write_text(json.dumps(pins_shard))
    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["pins"] = {"en": "pins.json"}
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url


def write_index_with_pins(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a pin: querying 'widget' also pins doc 2 at
    high priority."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "widget": {"mode": "exact", "docs": [{"id": 2, "priority": 10.0, "exclusive": False}]},
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_exclusive_pin(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus an *exclusive* pin: querying 'widget' matches
    both docs organically, but doc 2 is pinned with exclusive=True, so only the pin should
    surface."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "widget": {"mode": "exact", "docs": [{"id": 2, "priority": 10.0, "exclusive": True}]},
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_contains_pin(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a "contains"-mode pin on the phrase
    'red widget': any query whose tokens contain that phrase as a contiguous subsequence
    (e.g. "buy red widget now") should pin doc 2, even though the query text is not an
    exact match for the phrase."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "red widget": {
            "mode": "contains",
            "docs": [{"id": 2, "priority": 10.0, "exclusive": False}],
        },
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_exact_phrase_pin(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus an *exact*-mode pin on the phrase
    'red widget': unlike write_index_with_contains_pin, this should NOT match a longer
    query like "buy red widget now" since exact mode requires the whole normalized query
    to equal the phrase."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "red widget": {"mode": "exact", "docs": [{"id": 2, "priority": 10.0, "exclusive": False}]},
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_pin_excluded_by_filter(out_dir: Path) -> str:
    """Same two docs as write_index_with_category_facet (doc 1=red, doc 2=blue), plus a pin
    on doc 2 for the query 'widget'. Used to verify that an active filters={"category":
    "red"} excludes doc 2's pin even though the pin phrase matches the query."""
    manifest_url = write_index_with_category_facet(out_dir)
    pins_shard = {
        "widget": {"mode": "exact", "docs": [{"id": 2, "priority": 10.0, "exclusive": False}]},
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_pin_for_unindexed_query(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a pin keyed on a phrase ('gizmo') that
    doesn't exist as a term in any term shard at all, so the organic query match fails
    completely. Used to verify pins surface independently of organic match success."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "gizmo": {"mode": "exact", "docs": [{"id": 1, "priority": 5.0, "exclusive": False}]},
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_multi_pins(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus two "contains"-mode pin phrases ('red' and
    'widget') that both match the query "red widget" and both pin doc 2 (at different
    priorities: 5.0 and 20.0), while 'widget' additionally pins doc 1 (priority 8.0). Used
    to verify dedup-by-id-keep-highest-priority (doc 2 should appear once, at priority
    20.0's position) and priority-descending ordering across distinct pinned docs
    (doc 2 before doc 1)."""
    manifest_url = write_basic_index(out_dir)
    pins_shard = {
        "red": {"mode": "contains", "docs": [{"id": 2, "priority": 5.0, "exclusive": False}]},
        "widget": {
            "mode": "contains",
            "docs": [
                {"id": 2, "priority": 20.0, "exclusive": False},
                {"id": 1, "priority": 8.0, "exclusive": False},
            ],
        },
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_phrase_fixture(out_dir: Path) -> str:
    """Doc 1 = 'Noise Cancelling Headphones' (adjacent), doc 2 = 'Headphones with Noise and
    also Cancelling elsewhere' (not adjacent). Used to verify quoted-phrase matching requires
    consecutive positions within a field, not just co-occurrence of the words."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "nois": {"df": 2, "postings": [
            {"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 3}}},
            {"doc": 2, "fields": {"title": {"tf": 1, "pos": [2], "len": 7}}},
        ]},
        "cancel": {"df": 2, "postings": [
            {"doc": 1, "fields": {"title": {"tf": 1, "pos": [1], "len": 3}}},
            {"doc": 2, "fields": {"title": {"tf": 1, "pos": [6], "len": 7}}},
        ]},
        "headphon": {"df": 2, "postings": [
            {"doc": 1, "fields": {"title": {"tf": 1, "pos": [2], "len": 3}}},
            {"doc": 2, "fields": {"title": {"tf": 1, "pos": [0], "len": 7}}},
        ]},
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Noise Cancelling Headphones"}},
        "2": {
            "url": "https://example.com/2",
            "fields": {"title": "Headphones with Noise and also Cancelling elsewhere"},
        },
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    manifest = {
        "version": 1, "buildId": "test", "format": "json",
        "languages": ["en"], "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 2}, "avgFieldLength": {"en": {"title": 5.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 3}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_non_adjacent_pin(out_dir: Path) -> str:
    """Same phrase fixture as write_index_with_phrase_fixture (doc 1 = adjacent 'Noise
    Cancelling Headphones', doc 2 = non-adjacent), plus a pin: doc 2 is pinned
    (non-exclusive) for the exact query "noise cancelling" (stemmed pin key: "nois
    cancel"). Doc 2 does NOT pass organic phrase matching (words present but not
    adjacent), so pinning it exercises the pinned-doc scoring path, which bypasses the
    organic candidate-set filtering and calls the scorer directly against every pinned
    id -- meaning the phrase clause's restricted-postings-for-scoring is the *only*
    thing that can prevent doc 2 from getting full phrase-match credit here."""
    manifest_url = write_index_with_phrase_fixture(out_dir)
    pins_shard = {
        "nois cancel": {
            "mode": "exact",
            "docs": [{"id": 2, "priority": 10.0, "exclusive": False}],
        },
    }
    return _add_pins(out_dir, manifest_url, pins_shard)


def write_index_with_phrase_across_fields_fixture(out_dir: Path) -> str:
    """One doc, two fields ('title' and 'body'). Phrase word 1 ("noise") appears only in
    'title'; phrase word 2 ("cancelling") appears only in 'body'. Both words are present
    somewhere in the doc, but never adjacent within a single shared field, so a quoted
    phrase query for "noise cancelling" must NOT match this doc even though a bare AND of
    the same two words would."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "nois": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 2}}}],
        },
        "cancel": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"body": {"tf": 1, "pos": [1], "len": 3}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {
            "url": "https://example.com/1",
            "fields": {"title": "Noise Headphones", "body": "Great Cancelling Technology"},
        },
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    manifest = {
        "version": 1,
        "buildId": "test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}, "body": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {"title": 2.0, "body": 3.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 1]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_multi_doc_phrase_fixture(out_dir: Path) -> str:
    """Three docs: doc 1 and doc 3 have "Noise Cancelling" adjacent, doc 2 does not
    (same non-adjacent pattern as write_index_with_phrase_fixture). Used to verify
    phrase matching correctly identifies adjacency across multiple documents, not just
    the first one it happens to be tested against."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "nois": {
            "df": 3,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 3}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [2], "len": 7}}},
                {"doc": 3, "fields": {"title": {"tf": 1, "pos": [0], "len": 3}}},
            ],
        },
        "cancel": {
            "df": 3,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [1], "len": 3}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [6], "len": 7}}},
                {"doc": 3, "fields": {"title": {"tf": 1, "pos": [1], "len": 3}}},
            ],
        },
        "headphon": {
            "df": 2,
            "postings": [
                {"doc": 1, "fields": {"title": {"tf": 1, "pos": [2], "len": 3}}},
                {"doc": 2, "fields": {"title": {"tf": 1, "pos": [0], "len": 7}}},
            ],
        },
        "earbud": {
            "df": 1,
            "postings": [
                {"doc": 3, "fields": {"title": {"tf": 1, "pos": [2], "len": 3}}},
            ],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Noise Cancelling Headphones"}},
        "2": {
            "url": "https://example.com/2",
            "fields": {"title": "Headphones with Noise and also Cancelling elsewhere"},
        },
        "3": {"url": "https://example.com/3", "fields": {"title": "Noise Cancelling Earbuds"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    manifest = {
        "version": 1,
        "buildId": "test",
        "format": "json",
        "languages": ["en"],
        "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 3},
        "avgFieldLength": {"en": {"title": 5.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 4}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 3]}],
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_synonyms(out_dir: Path) -> str:
    """Doc 1 = 'Sofa', doc 2 = 'Couch' -- 'sofa'/'couch' are equivalent synonyms."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "sofa": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 1}}}],
        },
        "couch": {
            "df": 1,
            "postings": [{"doc": 2, "fields": {"title": {"tf": 1, "pos": [0], "len": 1}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Sofa"}},
        "2": {"url": "https://example.com/2", "fields": {"title": "Couch"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    (out_dir / "synonyms.json").write_text(json.dumps({"equivalences": [["sofa", "couch"]]}))
    manifest = {
        "version": 1, "buildId": "test", "format": "json",
        "languages": ["en"], "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 2}, "avgFieldLength": {"en": {"title": 1.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
        "synonyms": {"en": "synonyms.json"},
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_directional_synonym(out_dir: Path) -> str:
    """Doc 1 = 'Television', doc 2 = 'TV' -- a directional synonym map from 'tv' -> 'televis'
    (the stemmed form of 'television') (querying 'tv' expands to also match 'television', but
    querying 'television' does NOT expand to match 'tv'). Used to verify directional synonyms
    are one-way only. Term shard keys use the stemmed forms the analyzer actually produces
    ('televis' for 'television'; 'tv' is short enough the stemmer leaves it unchanged) so that
    query-time lookups (which are also stemmed) hit the same keys."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "televis": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 1}}}],
        },
        "tv": {
            "df": 1,
            "postings": [{"doc": 2, "fields": {"title": {"tf": 1, "pos": [0], "len": 1}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {"url": "https://example.com/1", "fields": {"title": "Television"}},
        "2": {"url": "https://example.com/2", "fields": {"title": "TV"}},
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    (out_dir / "synonyms.json").write_text(json.dumps({"directional": {"tv": ["televis"]}}))
    manifest = {
        "version": 1, "buildId": "test", "format": "json",
        "languages": ["en"], "defaultLanguage": "en",
        "fields": {"title": {"boost": 1.0, "stored": True}},
        "docCount": {"en": 2}, "avgFieldLength": {"en": {"title": 1.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 2]}],
        },
        "synonyms": {"en": "synonyms.json"},
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_synonym_double_match(out_dir: Path) -> str:
    """Doc 1 contains BOTH the literal term 'sofa' AND, in a different field, the synonym
    term 'couch' -- so querying 'sofa' with synonyms on matches doc 1 via two separate
    clauses (literal 'sofa' in 'title', synonym-expanded 'couch' in 'description'). Used to
    verify a doc matching via both the literal term and a synonym variant gets credit from
    both clauses (summed), rather than double-counted incorrectly or clobbered by whichever
    clause is processed last."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "terms").mkdir(exist_ok=True)
    (out_dir / "docs").mkdir(exist_ok=True)
    term_shard = {
        "sofa": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"title": {"tf": 1, "pos": [0], "len": 1}}}],
        },
        "couch": {
            "df": 1,
            "postings": [{"doc": 1, "fields": {"description": {"tf": 1, "pos": [0], "len": 1}}}],
        },
    }
    (out_dir / "terms" / "all.json").write_text(json.dumps(term_shard))
    doc_shard = {
        "1": {
            "url": "https://example.com/1",
            "fields": {"title": "Sofa", "description": "Also known as a couch"},
        },
    }
    (out_dir / "docs" / "0.json").write_text(json.dumps(doc_shard))
    (out_dir / "synonyms.json").write_text(json.dumps({"equivalences": [["sofa", "couch"]]}))
    manifest = {
        "version": 1, "buildId": "test", "format": "json",
        "languages": ["en"], "defaultLanguage": "en",
        "fields": {
            "title": {"boost": 1.0, "stored": True},
            "description": {"boost": 1.0, "stored": True},
        },
        "docCount": {"en": 1},
        "avgFieldLength": {"en": {"title": 1.0, "description": 4.0}},
        "shards": {
            "terms": [{"lang": "en", "prefix": "all", "file": "terms/all.json", "termCount": 2}],
            "docs": [{"shard": 0, "file": "docs/0.json", "idRange": [1, 1]}],
        },
        "synonyms": {"en": "synonyms.json"},
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest))
    return manifest_path.resolve().as_uri()


def write_index_with_hierarchy_facet(out_dir: Path) -> str:
    """Same two docs as write_basic_index, plus a 'category' hierarchy facet with
    separator '/' (deliberately NOT '>', which is search.py's hardcoded fallback
    default, so tests can tell real separator propagation apart from the fallback
    firing regardless): doc1='electronics/audio', doc2='electronics/video'.
    """
    manifest_url = write_basic_index(out_dir)
    (out_dir / "facets").mkdir(exist_ok=True)

    category_shard = {
        "type": "hierarchy",
        "separator": "/",
        "values": {
            "electronics/audio": {"count": 1, "docs": [1]},
            "electronics/video": {"count": 1, "docs": [2]},
        },
    }
    (out_dir / "facets" / "category.json").write_text(json.dumps(category_shard))

    manifest_path = out_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["shards"]["facets"] = [{"field": "category", "file": "facets/category.json"}]
    manifest_path.write_text(json.dumps(manifest))
    return manifest_url
