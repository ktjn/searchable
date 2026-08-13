from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]


def test_python_client_docs_describe_client() -> None:
    readme = (PACKAGE_ROOT / "README.md").read_text()
    assert "SearchClient" in readme
