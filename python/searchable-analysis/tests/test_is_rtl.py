from searchable_analysis.is_rtl import is_rtl_language


def test_detects_arabic_and_hebrew_as_rtl():
    assert is_rtl_language("ar") is True
    assert is_rtl_language("he") is True


def test_detects_ltr_languages_as_not_rtl():
    assert is_rtl_language("en") is False
    assert is_rtl_language("de") is False


def test_compares_only_the_primary_subtag():
    assert is_rtl_language("ar-EG") is True
    assert is_rtl_language("en-US") is False


def test_is_case_insensitive():
    assert is_rtl_language("AR") is True
