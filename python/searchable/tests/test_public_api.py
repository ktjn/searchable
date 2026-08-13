from pathlib import Path

import searchable.analysis

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[2]


def test_python_client_docs_describe_client() -> None:
    pyproject = (PACKAGE_ROOT / "pyproject.toml").read_text()
    assert 'name = "searchable"' in pyproject


def test_exports_the_full_public_api():
    assert searchable.analysis.analyze is not None
    assert searchable.analysis.normalize_phrase is not None
    assert searchable.analysis.detect_language is not None
    assert searchable.analysis.is_rtl_language is not None
    assert searchable.analysis.get_language_profile is not None
    assert searchable.analysis.get_registered_language_codes is not None
    assert searchable.analysis.stem_english is not None
    assert searchable.analysis.stem_german is not None
    assert searchable.analysis.stem_dutch is not None
    assert searchable.analysis.stem_norwegian is not None
    assert searchable.analysis.stem_swedish is not None
    assert searchable.analysis.segment_cjk_bigram is not None
    assert searchable.analysis.segment_sea_trigram is not None
    assert searchable.analysis.strip_diacritics is not None
    for name in (
        "english",
        "german",
        "swedish",
        "dutch",
        "norwegian_bokmal",
        "norwegian_nynorsk",
        "norwegian",
        "chinese",
        "japanese",
        "thai",
        "khmer",
        "lao",
    ):
        assert getattr(searchable.analysis, name).code


def test_registry_and_direct_profile_imports_agree():
    assert searchable.analysis.get_language_profile("en") is searchable.analysis.english
