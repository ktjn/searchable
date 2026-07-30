import re
from dataclasses import dataclass


@dataclass(frozen=True)
class HighlightSpan:
    text: str
    is_match: bool


@dataclass(frozen=True)
class HighlightTerm:
    term: str
    prefix: bool


def _build_pattern(terms: list[HighlightTerm]) -> re.Pattern[str] | None:
    unique: dict[tuple[str, bool], HighlightTerm] = {(t.term, t.prefix): t for t in terms}
    if not unique:
        return None
    ordered = sorted(unique.values(), key=lambda t: len(t.term), reverse=True)
    parts = ["\\b" + re.escape(t.term) + ("\\w*" if t.prefix else "\\b") for t in ordered]
    return re.compile(f"({'|'.join(parts)})", re.IGNORECASE | re.UNICODE)


def highlight_text(text: str, terms: list[HighlightTerm]) -> list[HighlightSpan]:
    pattern = _build_pattern(terms)
    if not pattern or not text:
        return [HighlightSpan(text=text, is_match=False)]

    spans: list[HighlightSpan] = []
    last_index = 0
    for match in pattern.finditer(text):
        start, end = match.span()
        if start > last_index:
            spans.append(HighlightSpan(text=text[last_index:start], is_match=False))
        spans.append(HighlightSpan(text=match.group(0), is_match=True))
        last_index = end
    if last_index < len(text):
        spans.append(HighlightSpan(text=text[last_index:], is_match=False))
    return spans or [HighlightSpan(text=text, is_match=False)]
