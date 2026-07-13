from searchable_analysis.segment_cjk import segment_cjk_bigram
from searchable_analysis.token_span import TokenSpan


def test_splits_a_run_of_cjk_characters_into_overlapping_bigrams():
    assert segment_cjk_bigram("自然語言") == [
        TokenSpan(text="自然", is_word_like=True),
        TokenSpan(text="然語", is_word_like=True),
        TokenSpan(text="語言", is_word_like=True),
    ]


def test_indexes_a_lone_single_character_cjk_run_as_that_one_character():
    assert segment_cjk_bigram("深") == [
        TokenSpan(text="深", is_word_like=True)
    ]


def test_segments_a_non_cjk_run_normally():
    spans = segment_cjk_bigram("深度learning")
    assert spans == [
        TokenSpan(text="深度", is_word_like=True),
        TokenSpan(text="learning", is_word_like=True),
    ]


def test_keeps_cjk_bigrams_and_latin_words_separate_across_whitespace():
    spans = segment_cjk_bigram("電腦 and 手機")
    assert [s.text for s in spans] == ["電腦", "and", "手機"]


def test_is_stable_across_repeated_calls():
    a = segment_cjk_bigram("自然語言處理")
    b = segment_cjk_bigram("自然語言處理")
    assert a == b


def test_returns_empty_list_for_empty_string():
    assert segment_cjk_bigram("") == []
