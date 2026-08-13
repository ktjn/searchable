from pathlib import Path

from searchable.indexer.discover import discover_html_documents


def test_discovers_html_files_recursively_with_sorted_stable_ids(tmp_path: Path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "a.html").write_text("<html><body>A</body></html>")
    (tmp_path / "docs" / "b.html").write_text("<html><body>B</body></html>")
    (tmp_path / "readme.html").write_text("<html><body>R</body></html>")
    (tmp_path / "readme.txt").write_text("not html")

    sources = discover_html_documents(str(tmp_path))

    assert len(sources) == 3
    urls = sorted(s.url for s in sources)
    assert urls == ["/docs/a", "/docs/b", "/readme"]
    ids = [s.id for s in sources]
    assert ids == sorted(ids)
    assert ids == list(range(len(sources)))


def test_reads_html_content(tmp_path: Path):
    (tmp_path / "page.html").write_text("<html><body>Hello</body></html>")
    sources = discover_html_documents(str(tmp_path))
    assert "Hello" in sources[0].html


def test_returns_empty_list_for_a_directory_with_no_html_files(tmp_path: Path):
    (tmp_path / "readme.txt").write_text("not html")
    assert discover_html_documents(str(tmp_path)) == []
