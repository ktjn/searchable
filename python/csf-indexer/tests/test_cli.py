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
        [sys.executable, "-m", "csf_indexer.cli", str(src_dir), str(out_dir)],
        capture_output=True,
        text=True,
        check=True,
    )

    assert "indexed 1 document(s)" in result.stdout
    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["docCount"]["en"] == 1


def test_cli_errors_with_usage_when_missing_arguments():
    result = subprocess.run(
        [sys.executable, "-m", "csf_indexer.cli"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "usage: csf-indexer" in result.stderr
