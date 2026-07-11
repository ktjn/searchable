import re

from csf_analysis.segment_ngram import segment_by_script_ngram
from csf_analysis.token_span import TokenSpan

# Han ideographs (+ Extension A), hiragana, katakana -- deliberately
# excludes Hangul (Korean is whitespace-delimited at the word level) and
# Thai/Khmer/Lao (see segment_sea.py's own script ranges).
_CJK_CHAR = re.compile(r"[぀-ヿ㐀-䶿一-鿿]")


def _is_cjk(ch: str) -> bool:
    return bool(_CJK_CHAR.match(ch))


def segment_cjk_bigram(text: str) -> list[TokenSpan]:
    return segment_by_script_ngram(text, _is_cjk, 2)
