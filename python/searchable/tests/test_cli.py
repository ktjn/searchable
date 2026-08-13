import json
import subprocess
import sys
from pathlib import Path

from tests.fixtures.build_index import write_basic_index, write_index_with_category_facet


def test_cli_indexes_a_directory_and_writes_a_manifest(tmp_path: Path):
    src_dir = tmp_path / "site"
    src_dir.mkdir()
    (src_dir / "index.html").write_text(
        '<html lang="en"><head><title>Home</title></head>'
        "<body><main><p>Welcome to our widgets store.</p></main></body></html>"
    )
    out_dir = tmp_path / "out"

    result = subprocess.run(
        [sys.executable, "-m", "searchable.indexer.cli", str(src_dir), str(out_dir)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "indexed 1 document(s)" in result.stdout
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["docCount"]["en"] == 1


def test_cli_errors_with_usage_when_missing_arguments():
    result = subprocess.run(
        [sys.executable, "-m", "searchable.indexer.cli"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "usage: searchable-indexer" in result.stderr


def test_cli_sections_flag_creates_section_documents(tmp_path: Path):
    src_dir = tmp_path / "site"
    src_dir.mkdir()
    (src_dir / "transactions.html").write_text(
        '<html lang="en"><head><title>Transactions</title></head>'
        "<body><main>"
        '<h2 id="commit-protocol">Commit Protocol</h2><p>Commit protocol details.</p>'
        '<h2 id="effects">Effects</h2><p>Effects of committing.</p>'
        "</main></body></html>"
    )
    out_dir = tmp_path / "out"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "searchable.indexer.cli",
            str(src_dir),
            str(out_dir),
            "--sections",
            "h2",
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "indexed 2 document(s)" in result.stdout
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["docCount"]["en"] == 2


def test_cli_sections_with_invalid_level_errors(tmp_path: Path):
    src_dir = tmp_path / "site"
    src_dir.mkdir()
    (src_dir / "index.html").write_text("<html><body><main>x</main></body></html>")
    out_dir = tmp_path / "out"

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "searchable.indexer.cli",
            str(src_dir),
            str(out_dir),
            "--sections",
            "banana",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "invalid --sections" in result.stderr


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "searchable.client.cli", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_query_command_json_output(tmp_path: Path):
    manifest_url = write_index_with_category_facet(tmp_path / "idx")
    result = _run_cli("query", manifest_url, "widget", "--json")
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["totalHits"] == 2


def test_query_command_human_output_lists_hits(tmp_path: Path):
    manifest_url = write_index_with_category_facet(tmp_path / "idx")
    result = _run_cli("query", manifest_url, "widget")
    assert result.returncode == 0
    assert "-- https://example.com/1" in result.stdout


def test_facet_command_json_output(tmp_path: Path):
    manifest_url = write_index_with_category_facet(tmp_path / "idx")
    result = _run_cli("facet", manifest_url, "category", "--json")
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert {v["value"] for v in payload["values"]} == {"red", "blue"}


def test_query_command_json_highlight_uses_camel_case_nested_keys(tmp_path: Path):
    manifest_url = write_basic_index(tmp_path / "idx")
    result = _run_cli("query", manifest_url, "widget", "--highlight", "--json")
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["totalHits"] >= 1
    spans = payload["hits"][0]["highlights"]["title"]
    assert spans, "expected at least one highlight span"
    assert any(span.get("isMatch") for span in spans)
    for span in spans:
        assert "is_match" not in span
        assert "isMatch" in span


def test_query_command_with_filter(tmp_path: Path):
    manifest_url = write_index_with_category_facet(tmp_path / "idx")
    result = _run_cli("query", manifest_url, "widget", "--filter", "category=red", "--json")
    payload = json.loads(result.stdout)
    assert payload["totalHits"] == 1
