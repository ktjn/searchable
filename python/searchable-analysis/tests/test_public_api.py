import searchable_analysis


def test_exports_the_full_public_api():
    assert searchable_analysis.analyze is not None
    assert searchable_analysis.normalize_phrase is not None
    assert searchable_analysis.detect_language is not None
    assert searchable_analysis.is_rtl_language is not None
    assert searchable_analysis.get_language_profile is not None
    assert searchable_analysis.get_registered_language_codes is not None
    assert searchable_analysis.stem_english is not None
    assert searchable_analysis.stem_german is not None
    assert searchable_analysis.segment_cjk_bigram is not None
    assert searchable_analysis.segment_sea_trigram is not None
    assert searchable_analysis.strip_diacritics is not None
    for name in ("english", "german", "chinese", "japanese", "thai", "khmer", "lao"):
        assert getattr(searchable_analysis, name).code


def test_registry_and_direct_profile_imports_agree():
    assert searchable_analysis.get_language_profile("en") is searchable_analysis.english
