import pytest
from selectolax.parser import HTMLParser

from searchable_indexer.build_index import build_index
from searchable_indexer.extract import extract_document, extract_sections
from searchable_indexer.types import SectionIndexingConfig, SourceDocument


def _src(doc_id: int, url: str, body: str, extra_head: str = "") -> SourceDocument:
    html = (
        f'<html lang="en"><head><title>Transactions</title>{extra_head}</head>'
        f"<body><main>{body}</main></body></html>"
    )
    return SourceDocument(id=doc_id, url=url, html=html)


def _sections(body: str, selectors: tuple[str, ...] = ("h2", "h3")):
    source = _src(1, "/docs/transactions/", body)
    doc = extract_document(source.html, source.url)
    tree = HTMLParser(source.html)
    return extract_sections(tree, doc.url, doc.title, selectors)


# --- extraction-level tests ---


def test_section_extraction_disabled_produces_single_page_document():
    built = build_index([_src(1, "/a", '<h2 id="x">X</h2><p>x body</p>')])
    assert built.manifest["docCount"]["en"] == 1
    assert built.doc_store["1"]["url"] == "/a"


def test_simple_h2_sections_split_and_anchor_urls():
    sections = _sections('<h2 id="a">A</h2><p>A1</p><h2 id="b">B</h2><p>B1</p>', ("h2",))
    assert [s.title for s in sections] == ["A", "B"]
    assert sections[0].url == "/docs/transactions/#a"
    assert sections[1].url == "/docs/transactions/#b"
    assert sections[0].page_title == "Transactions"


def test_mixed_hierarchy_nested_content_is_not_duplicated():
    sections = _sections(
        '<h2 id="a">A</h2><p>A1</p>'
        '<h3 id="a-1">A.1</h3><p>A2</p>'
        '<h3 id="a-2">A.2</h3><p>A3</p>'
        '<h2 id="b">B</h2><p>B1</p>'
    )
    by_title = {s.title: s.body for s in sections}
    assert by_title["A"] == "A1"
    assert by_title["A.1"] == "A2"
    assert by_title["A.2"] == "A3"


def test_unselected_headings_do_not_create_documents():
    sections = _sections(
        '<h2 id="a">A</h2><p>A1</p>'
        '<h4 id="ignored">Ignored</h4><p>mid</p>'
        '<h2 id="b">B</h2><p>B1</p>',
        ("h2",),
    )
    assert [s.title for s in sections] == ["A", "B"]
    # an unselected heading creates no document, but its text stays in the parent
    assert sections[0].body == "A1 Ignored mid"


def test_sections_with_nested_html_keep_inline_text():
    sections = _sections('<h2 id="a">A</h2><p>One <b>bold</b> phrase</p>')
    assert sections[0].body == "One bold phrase"


def test_headings_without_ids_are_skipped_with_warning(capsys):
    built = build_index(
        [
            _src(
                1,
                "/a",
                '<h2>No id</h2><p>content</p><h2 id="b">B</h2><p>b</p>',
            )
        ],
        section_indexing=SectionIndexingConfig(),
    )
    urls = [entry["url"] for entry in built.doc_store.values()]
    # only the heading with an id becomes a section document
    assert urls == ["/a#b"]
    captured = capsys.readouterr()
    # the no-id heading is a boundary but not indexed and warns
    assert 'no "id"' in captured.err


def test_duplicate_anchors_keep_first_and_warn(capsys):
    raised = build_index(
        [
            _src(
                1,
                "/a",
                '<h2 id="dup">First</h2><p>one</p><h2 id="dup">Second</h2><p>two</p>',
            )
        ],
        section_indexing=SectionIndexingConfig(),
    )
    urls = [entry["url"] for entry in raised.doc_store.values()]
    assert urls.count("/a#dup") == 1
    assert "duplicate section URL" in capsys.readouterr().err


def test_ignored_elements_are_excluded_from_section_bodies():
    html = (
        '<html lang="en"><head><title>T</title></head><body><main>'
        '<h2 id="a">A</h2>'
        "<p>real</p>"
        "<nav>nav junk</nav>"
        "<div data-searchable-ignore>ignored</div>"
        "</main></body></html>"
    )
    built = build_index(
        [SourceDocument(1, "/a", html)],
        section_indexing=SectionIndexingConfig(),
    )
    section = built.doc_store["2"]
    excerpt = section["fields"]["excerpt"]
    assert "real" in excerpt
    assert "junk" not in excerpt
    assert "ignored" not in excerpt


def test_searchable_noindex_suppresses_page_and_sections():
    html = (
        '<html lang="en"><head><title>T</title>'
        '<meta name="searchable-noindex" content="true"></head>'
        '<body><main><h2 id="a">A</h2><p>body</p></main></body></html>'
    )
    built = build_index(
        [SourceDocument(1, "/a", html)],
        section_indexing=SectionIndexingConfig(),
    )
    assert built.doc_store == {}
    assert built.term_shards == {}


def test_unsafe_canonical_url_falls_back_before_anchor_creation():
    html = (
        '<html lang="en"><head><title>T</title>'
        '<link rel="canonical" href="javascript:alert(1)"></head>'
        '<body><main><h2 id="a">A</h2><p>body</p></main></body></html>'
    )
    source = SourceDocument(1, "/page", html)
    built = build_index([source], section_indexing=SectionIndexingConfig())
    urls = [e["url"] for e in built.doc_store.values() if e["url"] != "/page"]
    assert all(u.startswith("/page#") for u in urls)


# --- inheritance-level tests (through build_index) ---


def test_boosts_facets_range_facets_and_metadata_are_inherited():
    extra = (
        '<meta name="searchable-boost" content="3.0">'
        '<meta name="searchable-facet-category" content="docs">'
        '<meta name="searchable-meta-type" content="specification">'
    )
    built = build_index(
        [
            _src(
                1,
                "/a",
                '<h2 id="x">X</h2><p>x body</p><h2 id="y">Y</h2><p>y body</p>',
                extra,
            )
        ],
        section_indexing=SectionIndexingConfig(selectors=("h2",)),
    )
    section_urls = [e["url"] for e in built.doc_store.values() if "#" in e["url"]]
    assert len(section_urls) == 2
    entry = next(e for e in built.doc_store.values() if "#x" in e["url"])
    assert entry.get("boost") == 3.0
    assert entry["metadata"]["type"] == "specification"
    assert entry["metadata"]["documentType"] == "section"
    assert isinstance(entry["metadata"]["headingLevel"], int)
    # the terms facet is inherited by both sections
    section_ids = [int(k) for k, e in built.doc_store.items() if "#" in e["url"]]
    facet_docs = built.facet_shards["category"]["values"]["docs"]["docs"]
    assert sorted(facet_docs) == sorted(section_ids)


def test_range_facet_inherited():
    built = build_index(
        [
            _src(
                1,
                "/a",
                '<h2 id="x">X</h2><p>x</p>',
                '<meta name="searchable-facet-range-price" content="5">',
            )
        ],
        section_indexing=SectionIndexingConfig(selectors=("h2",)),
    )
    assert built.facet_shards["price"]["type"] == "range"


def test_language_is_inherited_not_redetected_per_section():
    html = (
        '<html lang="de"><head><title>Titel</title></head>'
        '<body><main><h2 id="a">A</h2><p>kurz</p>'
        '<h2 id="b">B</h2><p>auch</p></main></body></html>'
    )
    built = build_index(
        [SourceDocument(1, "/de", html)],
        section_indexing=SectionIndexingConfig(selectors=("h2",)),
    )
    assert built.manifest["docCount"].keys() == {"de"}
    assert any(e["url"].startswith("/de#") for e in built.doc_store.values())


def test_empty_section_with_nonempty_heading_is_indexed():
    sections = _sections('<h2 id="a">Empty</h2><h2 id="b">B</h2><p>b</p>')
    bodies = {s.title: s.body for s in sections}
    assert bodies["Empty"] == ""


def test_section_with_neither_heading_nor_body_is_skipped():
    sections = _sections('<h2 id="a"></h2><h2 id="b">B</h2><p>b body</p>')
    assert [s.title for s in sections] == ["B"]


def test_content_before_first_section_is_preserved_as_introduction():
    built = build_index(
        [
            _src(
                1,
                "/a",
                "<h1>Transactions</h1><p>Overview text here.</p>"
                '<h2 id="model">Model</h2><p>model body</p>',
            )
        ],
        section_indexing=SectionIndexingConfig(selectors=("h2",)),
    )
    urls = [e["url"] for e in built.doc_store.values()]
    assert urls == ["/a", "/a#model"]
    intro = built.doc_store["1"]
    assert "Overview" in intro["fields"]["excerpt"]


def test_page_and_sections_mode_indexes_both():
    built = build_index(
        [_src(1, "/a", '<h2 id="a">A</h2><p>a body</p>')],
        section_indexing=SectionIndexingConfig(selectors=("h2",), mode="page-and-sections"),
    )
    urls = [e["url"] for e in built.doc_store.values()]
    assert urls == ["/a", "/a#a"]


def test_sections_only_falls_back_to_page_when_no_eligible_section():
    built = build_index(
        [_src(1, "/a", "<p>just a paragraph</p>")],
        section_indexing=SectionIndexingConfig(selectors=("h2",)),
    )
    assert built.manifest["docCount"]["en"] == 1
    assert built.doc_store["1"]["url"] == "/a"


def test_stable_document_ids_via_external_id():
    body = '<h2 id="a">A</h2><p>a body</p><h2 id="b">B</h2><p>b body</p>'
    first = build_index([_src(1, "/a", body)], section_indexing=SectionIndexingConfig())
    second = build_index([_src(1, "/a", body)], section_indexing=SectionIndexingConfig())
    first_ids = [e["url"] for e in first.doc_store.values() if "#" in e["url"]]
    second_ids = [e["url"] for e in second.doc_store.values() if "#" in e["url"]]
    assert first_ids == second_ids
    assert sorted(first_ids) == ["/a#a", "/a#b"]


def test_html_entities_and_unicode_headings_are_preserved():
    sections = _sections(
        '<h2 id="café">Café &amp; Thé</h2><p>body</p><h2 id="résumé">Résumé</h2><p>more</p>'
    )
    assert sections[0].title == "Café & Thé"


def test_invalid_section_config_selectors_raise():
    with pytest.raises(ValueError, match="h1..h6"):
        build_index(
            [_src(1, "/a", "<p>x</p>")],
            section_indexing=SectionIndexingConfig(selectors=("span",)),
        )


def test_invalid_section_mode_raises():
    with pytest.raises(ValueError, match="mode"):
        build_index(
            [_src(1, "/a", "<p>x</p>")],
            section_indexing=SectionIndexingConfig(mode="banana"),
        )
