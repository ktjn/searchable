from searchable.analysis import english
from searchable.client.parse_query import parse_query, parse_query_terms


def test_plain_terms_are_analyzed():
    terms = parse_query_terms("running shoes", english)
    assert [t.term for t in terms] == ["run", "shoe"]
    assert all(not t.prefix for t in terms)


def test_trailing_star_marks_prefix_and_strips_star():
    terms = parse_query_terms("shoe*", english)
    assert len(terms) == 1
    assert terms[0].prefix is True
    assert terms[0].term == "shoe"


def test_duplicate_terms_are_deduplicated_by_prefix_and_exact_separately():
    terms = parse_query_terms("run run run*", english)
    keys = {(t.term, t.prefix) for t in terms}
    assert keys == {("run", False), ("run", True)}


def test_quoted_phrase_extracted_separately_from_plain_terms():
    parsed = parse_query('wireless "noise cancelling" headphones', english)
    assert [t.term for t in parsed.terms] == ["wireless", "headphon"]
    assert len(parsed.phrases) == 1
    assert [t.term for t in parsed.phrases[0].terms] == ["nois", "cancel"]


def test_unterminated_quote_falls_back_to_plain_term_parsing():
    parsed = parse_query('wireless "noise', english)
    assert parsed.phrases == []
    assert "wireless" in [t.term for t in parsed.terms]
