import re

from searchable.analysis.token_span import TokenSpan

# Unicode "word" characters (letters, digits, combining marks) excluding
# the underscore that \w normally includes -- "under_score" should split
# into two words, matching what Intl.Segmenter's word-boundary algorithm
# does for an underscore (not a letter/digit/mark) in practice.
_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def segment_latin_words(text: str) -> list[TokenSpan]:
    return [TokenSpan(text=match.group(0), is_word_like=True) for match in _WORD_RE.finditer(text)]
