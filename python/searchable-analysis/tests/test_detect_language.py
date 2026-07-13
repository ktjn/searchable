from searchable_analysis.detect_language import detect_language


def test_detects_english_via_marker_words():
    text = "The quick brown fox is with the lazy dog and this is a test"
    assert detect_language(text, ["en", "de"]) == "en"


def test_detects_german_via_marker_words():
    text = "Das ist ein Test und die Katze ist auf dem Tisch sich mit"
    assert detect_language(text, ["en", "de"]) == "de"


def test_detects_japanese_via_kana_script_dominance():
    text = "こんにちは世界"
    assert detect_language(text, ["en", "ja", "zh"]) == "ja"


def test_detects_chinese_via_han_script_with_no_kana():
    text = "你好世界这是中文"
    assert detect_language(text, ["en", "ja", "zh"]) == "zh"


def test_returns_none_when_script_detected_but_not_offered_as_a_candidate():
    text = "こんにちは世界"
    assert detect_language(text, ["en", "zh"]) is None


def test_returns_none_with_no_confident_signal():
    assert detect_language("xyz 123", ["en", "de"]) is None


def test_returns_none_on_a_tie():
    # Equal marker-word counts for en and de -- no confident winner.
    text = "the and der und"
    assert detect_language(text, ["en", "de"]) is None
