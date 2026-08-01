from pathlib import Path


def test_client_package_metadata_advertises_vector_support() -> None:
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    assert 'version = "0.3.0"' in text
    assert "vector and hybrid" in text.lower()
