from searchable.client.highlight import HighlightSpan, HighlightTerm, highlight_text


def test_no_terms_returns_single_non_match_span():
    spans = highlight_text("hello world", [])
    assert spans == [HighlightSpan(text="hello world", is_match=False)]


def test_matches_case_insensitively_and_splits_spans():
    spans = highlight_text("Wireless Headphones", [HighlightTerm(term="headphones", prefix=False)])
    texts_and_match = [(s.text, s.is_match) for s in spans]
    assert texts_and_match == [("Wireless ", False), ("Headphones", True)]


def test_prefix_term_matches_word_continuation():
    spans = highlight_text("Category electronics", [HighlightTerm(term="cat", prefix=True)])
    assert any(s.is_match and s.text.lower() == "category" for s in spans)


def test_longer_term_wins_over_shorter_substring_term():
    spans = highlight_text(
        "category",
        [
            HighlightTerm(term="cat", prefix=False),
            HighlightTerm(term="category", prefix=False),
        ],
    )
    match_spans = [s.text for s in spans if s.is_match]
    assert match_spans == ["category"]
