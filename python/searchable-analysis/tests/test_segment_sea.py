from searchable_analysis.segment_sea import segment_sea_trigram
from searchable_analysis.token_span import TokenSpan


def test_splits_a_run_of_thai_characters_into_overlapping_trigrams():
    spans = segment_sea_trigram("สวัสดี")
    assert spans == [
        TokenSpan(text="สวั", is_word_like=True),
        TokenSpan(text="วัส", is_word_like=True),
        TokenSpan(text="ัสด", is_word_like=True),
        TokenSpan(text="สดี", is_word_like=True),
    ]


def test_indexes_a_short_run_below_trigram_width_as_one_span():
    assert segment_sea_trigram("กข") == [
        TokenSpan(text="กข", is_word_like=True)
    ]


def test_segments_a_non_sea_run_normally():
    spans = segment_sea_trigram("กขhello")
    assert spans[-1] == TokenSpan(text="hello", is_word_like=True)


def test_returns_empty_list_for_empty_string():
    assert segment_sea_trigram("") == []
