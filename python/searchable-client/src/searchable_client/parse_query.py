import re
from dataclasses import dataclass, field

from searchable_analysis import LanguageProfile, analyze  # type: ignore[import-untyped]


@dataclass(frozen=True)
class QueryTerm:
    term: str
    prefix: bool
    literal: str


@dataclass(frozen=True)
class PhraseTerm:
    terms: list[QueryTerm]


@dataclass(frozen=True)
class ParsedQuery:
    terms: list[QueryTerm]
    phrases: list[PhraseTerm] = field(default_factory=list)


def parse_query_terms(query: str, profile: LanguageProfile) -> list[QueryTerm]:
    raw_tokens = [t for t in query.strip().split() if t]
    seen: set[str] = set()
    result: list[QueryTerm] = []
    for raw in raw_tokens:
        is_prefix = len(raw) > 1 and raw.endswith("*")
        text = raw[:-1] if is_prefix else raw
        for token in analyze(text, profile):
            key = f"{'prefix' if is_prefix else 'exact'}:{token.term}"
            if key in seen:
                continue
            seen.add(key)
            result.append(QueryTerm(term=token.term, prefix=is_prefix, literal=token.literal))
    return result


_QUOTED_PHRASE = re.compile(r'"([^"]+)"')


def parse_query(query: str, profile: LanguageProfile) -> ParsedQuery:
    phrases: list[PhraseTerm] = []

    def _extract(match: re.Match[str]) -> str:
        inner = match.group(1)
        phrase_terms = [
            QueryTerm(term=token.term, prefix=False, literal=token.literal)
            for raw in inner.strip().split()
            for token in analyze(raw, profile)
        ]
        if phrase_terms:
            phrases.append(PhraseTerm(terms=phrase_terms))
        return " "

    remainder = _QUOTED_PHRASE.sub(_extract, query)
    return ParsedQuery(terms=parse_query_terms(remainder, profile), phrases=phrases)
