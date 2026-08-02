import unicodedata
from dataclasses import dataclass
from typing import Callable

from searchable_analysis.segment_cjk import segment_cjk_bigram
from searchable_analysis.segment_latin import segment_latin_words
from searchable_analysis.segment_sea import segment_sea_trigram
from searchable_analysis.stemmer_de import stem_german as _stem_german
from searchable_analysis.stemmer_en import stem_english as _stem_english
from searchable_analysis.stemmer_nl import stem_dutch as _stem_dutch
from searchable_analysis.stemmer_no import stem_norwegian as _stem_norwegian
from searchable_analysis.stemmer_sv import stem_swedish as _stem_swedish
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


# Standard English function/interrogative words: they carry no topical
# meaning on their own, but under BM25's corpus-relative IDF they can still
# outscore genuinely rare content words in a small, specialized corpus where
# they appear infrequently in formal prose (e.g. "what does X mean" against
# a technical reference). Filtering them at analysis time -- for both
# indexing and querying, since analyze() is shared -- keeps queries focused
# on content words without needing per-corpus tuning. Based on the classic
# Lucene/SMART English stopword list, extended with common
# question/auxiliary words relevant to natural-language questions.
_ENGLISH_STOPWORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "can",
        "could", "did", "do", "does", "for", "he", "how", "i", "if", "in",
        "into", "is", "it", "mean", "meaning", "me", "no", "not", "of",
        "on", "or", "please", "she", "should", "such", "tell", "that",
        "the", "their", "then", "there", "these", "they", "this", "to",
        "was", "we", "what", "when", "where", "which", "who", "whom",
        "will", "with", "would", "you",
    }
)

english = LanguageProfile(
    code="en",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=_ENGLISH_STOPWORDS,
    stem=_stem_english,
)

german = LanguageProfile(
    code="de",
    segment=segment_latin_words,
    fold_diacritics=False,
    stopwords=frozenset(),
    stem=_stem_german,
)

swedish = LanguageProfile("sv", segment_latin_words, False, frozenset(), _stem_swedish)
dutch = LanguageProfile("nl", segment_latin_words, False, frozenset(), _stem_dutch)
norwegian_bokmal = LanguageProfile("nb", segment_latin_words, False, frozenset(), _stem_norwegian)
norwegian_nynorsk = LanguageProfile("nn", segment_latin_words, False, frozenset(), _stem_norwegian)
norwegian = LanguageProfile("no", segment_latin_words, False, frozenset(), _stem_norwegian)

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
