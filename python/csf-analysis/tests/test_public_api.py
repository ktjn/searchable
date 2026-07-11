import csf_analysis


def test_exports_the_full_public_api():
    assert csf_analysis.analyze is not None
    assert csf_analysis.normalize_phrase is not None
    assert csf_analysis.detect_language is not None
    assert csf_analysis.is_rtl_language is not None
    assert csf_analysis.get_language_profile is not None
    assert csf_analysis.get_registered_language_codes is not None
    assert csf_analysis.stem_english is not None
    assert csf_analysis.stem_german is not None
    assert csf_analysis.segment_cjk_bigram is not None
    assert csf_analysis.segment_sea_trigram is not None
    assert csf_analysis.strip_diacritics is not None
    for name in ("english", "german", "chinese", "japanese", "thai", "khmer", "lao"):
        assert getattr(csf_analysis, name).code


def test_registry_and_direct_profile_imports_agree():
    assert csf_analysis.get_language_profile("en") is csf_analysis.english
