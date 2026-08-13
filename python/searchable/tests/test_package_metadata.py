from pathlib import Path


def test_client_package_metadata() -> None:
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    assert 'version = "2.0.0"' in text
