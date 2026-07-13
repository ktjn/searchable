import re

from searchable_analysis.segment_ngram import segment_by_script_ngram
from searchable_analysis.token_span import TokenSpan

# Thai (U+0E00-0E7F) + Lao (U+0E80-0EFF), a contiguous pair of blocks,
# plus Khmer (U+1780-17FF).
_SEA_CHAR = re.compile(r"[฀-໿ក-៿]")


def _is_sea(ch: str) -> bool:
    return bool(_SEA_CHAR.match(ch))


def segment_sea_trigram(text: str) -> list[TokenSpan]:
    return segment_by_script_ngram(text, _is_sea, 3)
