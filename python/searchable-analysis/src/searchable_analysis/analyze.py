import unicodedata
from dataclasses import dataclass

from searchable_analysis.language_profile import LanguageProfile, strip_diacritics


@dataclass(frozen=True)
class Token:
    term: str
    position: int
    literal: str


def analyze(text: str, profile: LanguageProfile) -> list[Token]:
    normalized = unicodedata.normalize("NFKC", text)
    tokens: list[Token] = []
    position = 0

    for span in profile.segment(normalized):
        if not span.is_word_like:
            continue

        literal = span.text.lower()
        if profile.fold_diacritics:
            literal = strip_diacritics(literal)
        if literal in profile.stopwords:
            continue

        term = profile.stem(literal)
        tokens.append(Token(term=term, position=position, literal=literal))
        position += 1

    return tokens


def normalize_phrase(text: str, profile: LanguageProfile) -> str:
    return " ".join(t.term for t in analyze(text, profile))
