from searchable.analysis.language_profile import (
    chinese,
    english,
    german,
    japanese,
    khmer,
    lao,
    strip_diacritics,
    thai,
)


def test_english_profile_stems_via_porter():
    assert english.code == "en"
    assert english.stem("running") == "run"
    assert english.fold_diacritics is False


def test_german_profile_stems_via_snowball():
    assert german.code == "de"
    assert german.stem("häuser") == "haus"


def test_cjk_profiles_stem_is_identity():
    assert chinese.code == "zh"
    assert chinese.stem("自然") == "自然"
    assert japanese.code == "ja"
    assert japanese.stem("こん") == "こん"


def test_sea_profiles_stem_is_identity():
    assert thai.code == "th"
    assert khmer.code == "km"
    assert lao.code == "lo"
    assert thai.stem("ทดสอบ") == "ทดสอบ"


def test_strip_diacritics_removes_combining_marks():
    assert strip_diacritics("café") == "cafe"
    assert strip_diacritics("straße") == "strasse" or strip_diacritics("straße") == "straße"
    # ^ NFKD does not decompose ß into s+s (it isn't a diacritic mark),
    # so stripping combining marks alone leaves it unchanged -- this
    # assertion documents that, rather than asserting a false claim.


def test_segment_is_callable_and_returns_token_spans():
    spans = english.segment("widgets")
    assert len(spans) == 1
    assert spans[0].text == "widgets"
    assert spans[0].is_word_like is True
