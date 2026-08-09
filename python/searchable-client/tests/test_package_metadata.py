from pathlib import Path


def test_client_package_metadata_advertises_vector_support() -> None:
    text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    # x-release-please-start-version
    assert 'version = "0.4.2"' in text
    # x-release-please-end
    assert "vector and hybrid" in text.lower()
