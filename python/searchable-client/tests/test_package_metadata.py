from pathlib import Path


def test_client_package_metadata() -> None:
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    assert 'version = "1.4.1"' in text
