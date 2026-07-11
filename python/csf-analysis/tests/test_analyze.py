from csf_analysis.analyze import analyze, normalize_phrase
from csf_analysis.language_profile import english, german


def test_analyze_lowercases_and_stems():
    tokens = analyze("Running Widgets", english)
    assert [t.term for t in tokens] == ["run", "widget"]
    assert [t.literal for t in tokens] == ["running", "widgets"]
    assert [t.position for t in tokens] == [0, 1]


def test_analyze_normalizes_nfkc():
    # NFKC-normalizes before segmenting -- a decomposed character
    # (e.g. combining acute accent) collapses to its precomposed form.
    tokens = analyze("café", english)  # e + combining acute accent
    assert tokens[0].literal == "café"


def test_analyze_returns_empty_list_for_empty_string():
    assert analyze("", english) == []


def test_analyze_german_stems_via_snowball():
    tokens = analyze("Häuser", german)
    assert tokens[0].term == "haus"


def test_normalize_phrase_joins_stemmed_terms_with_a_space():
    assert normalize_phrase("Running Widgets", english) == "run widget"


def test_normalize_phrase_is_stable_for_case_variation():
    assert normalize_phrase("New York", english) == normalize_phrase(
        "new york", english
    )
