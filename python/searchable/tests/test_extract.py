from searchable.indexer.extract import extract_document


def test_extracts_title_and_body():
    html = """
    <html lang="en">
      <head><title>Widgets</title></head>
      <body><main><p>Our widgets are wonderful.</p></main></body>
    </html>
    """
    doc = extract_document(html, "/widgets")
    assert doc.title == "Widgets"
    assert "wonderful" in doc.body
    assert doc.language == "en"


def test_strips_boilerplate_elements_from_body():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body>
        <main>
          <nav>Skip this nav</nav>
          <p>Real content.</p>
          <footer>Skip this footer</footer>
        </main>
      </body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "Real content" in doc.body
    assert "Skip this nav" not in doc.body
    assert "Skip this footer" not in doc.body


def test_prefers_data_searchable_body_over_main_over_body():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body>
        <main>Not this</main>
        <div data-searchable-body>This is the real content</div>
      </body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "This is the real content" in doc.body
    assert "Not this" not in doc.body


def test_falls_back_to_detected_language_when_no_html_lang():
    html = """
    <html>
      <head><title>Test</title></head>
      <body><main><p>The quick brown fox is with the lazy dog and this is a test</p></main></body>
    </html>
    """
    doc = extract_document(html, "/page", default_language="en")
    assert doc.language == "en"


def test_preserves_explicit_generic_norwegian_compatibility_code():
    html = (
        '<html lang="no"><head><title>Norsk</title></head>'
        "<body><main>Ikke jeg hva også hvordan hvem.</main></body></html>"
    )
    assert extract_document(html, "/norsk").language == "no"


def test_noindex_meta_tag_sets_noindex_true():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-noindex" content="true"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.noindex is True


def test_boost_meta_tag_parses_a_positive_float():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-boost" content="2.5"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.boost == 2.5


def test_invalid_boost_falls_back_to_1():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-boost" content="not-a-number"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.boost == 1.0


def test_canonical_link_overrides_source_url():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://example.com/real-url"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "https://example.com/real-url"


def test_canonical_link_off_allowlist_falls_back_to_source_url():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://evil.com/real-url"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "/page"


def test_canonical_link_mixed_case_host_matches_lowercase_allowlist():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://EXAMPLE.com/page"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "https://EXAMPLE.com/page"


def test_canonical_link_with_userinfo_matches_allowlist():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="https://user@example.com/page"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page", allowed_url_origins=["https://example.com"])
    assert doc.url == "https://user@example.com/page"


def test_root_relative_canonical_is_accepted_as_is():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="/canonical-path"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.url == "/canonical-path"


def test_javascript_scheme_canonical_is_rejected():
    html = """
    <html lang="en">
      <head><title>T</title><link rel="canonical" href="javascript:alert(1)"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.url == "/page"


def test_excerpt_from_meta_description():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="description" content="A short summary."></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.excerpt == "A short summary."


def test_facet_meta_tags_collect_distinct_values():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="searchable-facet-category" content="Electronics">
        <meta name="searchable-facet-category" content="Audio">
        <meta name="searchable-facet-category" content="Electronics">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.facets["category"] == ["Electronics", "Audio"]


def test_range_facet_meta_tag_parses_a_single_numeric_value():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-facet-range-price" content="49.99"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.range_facets["price"] == 49.99


def test_range_facet_prefix_does_not_get_misparsed_as_a_terms_facet():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-facet-range-price" content="10"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "range-price" not in doc.facets
    assert doc.range_facets["price"] == 10.0


def test_geo_facet_meta_tag_parses_a_lat_lon_pair():
    html = """
    <html lang="en">
      <head><title>T</title>
      <meta name="searchable-facet-geo-location" content="51.5074,-0.1278"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.geo_facets["location"] == (51.5074, -0.1278)
    assert "geo-location" not in doc.facets


def test_geo_facet_prefix_does_not_get_misparsed_as_a_terms_or_range_facet():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-facet-geo-location" content="10,20"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.geo_facets["location"] == (10.0, 20.0)
    assert "location" not in doc.range_facets
    assert "location" not in doc.facets


def test_geo_facet_out_of_range_latitude_is_ignored():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-facet-geo-location" content="200,20"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "location" not in doc.geo_facets


def test_geo_facet_malformed_content_is_ignored():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-facet-geo-location" content="not-a-point"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert "location" not in doc.geo_facets


def test_pin_meta_tags_produce_pin_declarations():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="searchable-pin" content="widgets">
        <meta name="searchable-pin-mode" content="contains">
        <meta name="searchable-pin-priority" content="5">
        <meta name="searchable-pin-exclusive">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert len(doc.pins) == 1
    pin = doc.pins[0]
    assert pin.phrase == "widgets"
    assert pin.mode == "contains"
    assert pin.priority == 5.0
    assert pin.exclusive is True


def test_pin_defaults_when_mode_and_priority_absent():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="searchable-pin" content="gadgets"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.pins[0].mode == "exact"
    assert doc.pins[0].priority == 0.0
    assert doc.pins[0].exclusive is False


def test_no_pins_when_no_searchable_pin_tag_present():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.pins == []


def test_generic_meta_metadata_is_collected():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="searchable-meta-type" content="specification">
        <meta name="searchable-meta-area" content="transactions">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.metadata == {"type": "specification", "area": "transactions"}


def test_duplicate_generic_meta_keeps_the_first_value():
    html = """
    <html lang="en">
      <head>
        <title>T</title>
        <meta name="searchable-meta-type" content="first">
        <meta name="searchable-meta-type" content="second">
      </head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.metadata == {"type": "first"}


def test_no_generic_metadata_by_default():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.metadata == {}
