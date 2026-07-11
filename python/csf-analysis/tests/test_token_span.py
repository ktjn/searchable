from csf_analysis.token_span import TokenSpan


def test_token_span_holds_text_and_is_word_like():
    span = TokenSpan(text="widget", is_word_like=True)
    assert span.text == "widget"
    assert span.is_word_like is True


def test_token_span_is_frozen():
    span = TokenSpan(text="widget", is_word_like=True)
    try:
        span.text = "other"
        raised = False
    except AttributeError:
        raised = True
    assert raised
