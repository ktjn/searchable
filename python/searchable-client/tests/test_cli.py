import json
import subprocess
import sys
from pathlib import Path

from tests.fixtures.build_index import write_basic_index, write_index_with_category_facet


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "searchable_client.cli", *args],
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
    assert "example.com" in result.stdout


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
