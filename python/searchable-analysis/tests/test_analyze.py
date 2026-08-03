from searchable_analysis.analyze import analyze, normalize_phrase
from searchable_analysis.language_profile import dutch, english, german, norwegian_bokmal, swedish


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


def test_analyze_nordic_and_dutch_stem_via_snowball():
    assert analyze("husets", swedish)[0].term == "hus"
    assert analyze("husets", norwegian_bokmal)[0].term == "hus"
    assert analyze("huizen", dutch)[0].term == "huis"


def test_normalize_phrase_joins_stemmed_terms_with_a_space():
    assert normalize_phrase("Running Widgets", english) == "run widget"


def test_normalize_phrase_is_stable_for_case_variation():
    assert normalize_phrase("New York", english) == normalize_phrase(
        "new york", english
    )


def test_analyze_drops_english_stopwords():
    tokens = analyze("what does additive mean", english)
    assert [t.term for t in tokens] == ["addit"]


def test_analyze_drops_german_stopwords():
    # "und" and "ist" are German stopwords
    tokens = analyze("Häuser und Autos ist gut", german)
    assert [t.term for t in tokens] == ["haus", "autos", "gut"]


def test_analyze_keeps_content_words_around_stopwords():
    tokens = analyze("how do I configure the registry", english)
    assert [t.term for t in tokens] == ["configur", "registri"]
