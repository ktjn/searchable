import unicodedata
from dataclasses import dataclass
from typing import Callable

from searchable_analysis.segment_cjk import segment_cjk_bigram
from searchable_analysis.segment_latin import segment_latin_words
from searchable_analysis.segment_sea import segment_sea_trigram
from searchable_analysis.stemmer_de import stem_german as _stem_german
from searchable_analysis.stemmer_en import stem_english as _stem_english
from searchable_analysis.token_span import TokenSpan


@dataclass(frozen=True)
class LanguageProfile:
    code: str
    segment: Callable[[str], list[TokenSpan]]
    fold_diacritics: bool
    stopwords: frozenset
    stem: Callable[[str], str]


def strip_diacritics(term: str) -> str:
    decomposed = unicodedata.normalize("NFKD", term)
    return "".join(c for c in decomposed if not unicodedata.category(c).startswith("M"))


def _identity(term: str) -> str:
    return term


english = LanguageProfile(
    code="en",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_stem_english,
)

german = LanguageProfile(
    code="de",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_stem_german,
)

chinese = LanguageProfile(
    code="zh",
    segment=segment_cjk_bigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

japanese = LanguageProfile(
    code="ja",
    segment=segment_cjk_bigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

thai = LanguageProfile(
    code="th",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

khmer = LanguageProfile(
    code="km",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)

lao = LanguageProfile(
    code="lo",
    segment=segment_sea_trigram,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_identity,
)
