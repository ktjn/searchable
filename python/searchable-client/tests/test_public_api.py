from pathlib import Path

import searchable_client


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[3]


def test_public_package_exports_vector_errors() -> None:
    assert searchable_client.VectorSearchNotConfiguredError
    assert searchable_client.VectorProviderMismatchError


def test_python_client_docs_describe_injected_vector_search() -> None:
    readme = (PACKAGE_ROOT / "README.md").read_text()
    reference = (ROOT / "docs" / "reference" / "python-client-api.md").read_text()
    assert "embed_query" in readme
    assert "mode" in reference
    assert "vector/hybrid search is not implemented" not in reference
