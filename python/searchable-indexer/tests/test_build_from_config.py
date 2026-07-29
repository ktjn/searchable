import json
import subprocess
import sys
from pathlib import Path


def test_build_from_config_writes_manifest(tmp_path: Path) -> None:
    sources_path = tmp_path / "sources.json"
    config_path = tmp_path / "config.json"
    out_dir = tmp_path / "out"

    sources_path.write_text(
        json.dumps(
            [
                {
                    "id": 0,
                    "url": "/a",
                    "html": (
                        '<html lang="en"><head><title>Widgets</title></head>'
                        "<body><main><p>Our widgets are wonderful.</p></main>"
                        "</body></html>"
                    ),
                }
            ]
        ),
        encoding="utf-8",
    )
    config_path.write_text(json.dumps({"build": {"fuzzy": True}, "write": {}}), encoding="utf-8")

    script_path = Path(__file__).parent.parent / "scripts" / "build_from_config.py"
    subprocess.run(
        [sys.executable, str(script_path), str(sources_path), str(config_path), str(out_dir)],
        check=True,
    )

    manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["docCount"]["en"] == 1
    assert "fuzzy" in manifest
