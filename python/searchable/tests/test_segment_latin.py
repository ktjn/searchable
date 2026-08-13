from searchable.analysis.segment_latin import segment_latin_words
from searchable.analysis.token_span import TokenSpan


def test_splits_on_whitespace():
    assert segment_latin_words("hello world") == [
        TokenSpan(text="hello", is_word_like=True),
        TokenSpan(text="world", is_word_like=True),
    ]


def test_splits_on_punctuation():
    assert segment_latin_words("widgets, gadgets.") == [
        TokenSpan(text="widgets", is_word_like=True),
        TokenSpan(text="gadgets", is_word_like=True),
    ]


def test_keeps_unicode_letters_together():
    assert segment_latin_words("café schön") == [
        TokenSpan(text="café", is_word_like=True),
        TokenSpan(text="schön", is_word_like=True),
    ]


def test_empty_string_yields_no_spans():
    assert segment_latin_words("") == []


def test_underscore_is_a_boundary_not_a_word_character():
    assert segment_latin_words("under_score") == [
        TokenSpan(text="under", is_word_like=True),
        TokenSpan(text="score", is_word_like=True),
    ]
