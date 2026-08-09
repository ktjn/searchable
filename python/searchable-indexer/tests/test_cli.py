import json
import subprocess
import sys
from pathlib import Path


def test_cli_indexes_a_directory_and_writes_a_manifest(tmp_path: Path):
    src_dir = tmp_path / "site"
    src_dir.mkdir()
    (src_dir / "index.html").write_text(
        '<html lang="en"><head><title>Home</title></head>'
        "<body><main><p>Welcome to our widgets store.</p></main></body></html>"
    )
    out_dir = tmp_path / "out"

    result = subprocess.run(
        [sys.executable, "-m", "searchable_indexer.cli", str(src_dir), str(out_dir)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "indexed 1 document(s)" in result.stdout
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["docCount"]["en"] == 1


def test_cli_errors_with_usage_when_missing_arguments():
    result = subprocess.run(
        [sys.executable, "-m", "searchable_indexer.cli"],
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
            "searchable_indexer.cli",
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
            "searchable_indexer.cli",
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
