from csf_indexer.extract import extract_document


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


def test_prefers_data_csf_body_over_main_over_body():
    html = """
    <html lang="en">
      <head><title>T</title></head>
      <body>
        <main>Not this</main>
        <div data-csf-body>This is the real content</div>
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


def test_noindex_meta_tag_sets_noindex_true():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-noindex" content="true"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.noindex is True


def test_boost_meta_tag_parses_a_positive_float():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-boost" content="2.5"></head>
      <body><main>Content</main></body>
    </html>
    """
    doc = extract_document(html, "/page")
    assert doc.boost == 2.5


def test_invalid_boost_falls_back_to_1():
    html = """
    <html lang="en">
      <head><title>T</title><meta name="csf-boost" content="not-a-number"></head>
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
