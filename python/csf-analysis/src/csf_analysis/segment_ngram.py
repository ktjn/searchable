from typing import Callable

from csf_analysis.segment_latin import segment_latin_words
from csf_analysis.token_span import TokenSpan


def _segment_script_run(run: list[str], n: int) -> list[TokenSpan]:
    if len(run) < n:
        return [TokenSpan(text="".join(run), is_word_like=True)]
    spans: list[TokenSpan] = []
    for i in range(len(run) - n + 1):
        spans.append(TokenSpan(text="".join(run[i : i + n]), is_word_like=True))
    return spans


def segment_by_script_ngram(
    text: str, is_in_script: Callable[[str], bool], n: int
) -> list[TokenSpan]:
    chars = list(text)
    spans: list[TokenSpan] = []
    i = 0
    while i < len(chars):
        in_script = is_in_script(chars[i])
        j = i
        while j < len(chars) and is_in_script(chars[j]) == in_script:
            j += 1
        run = chars[i:j]
        if in_script:
            spans.extend(_segment_script_run(run, n))
        else:
            spans.extend(segment_latin_words("".join(run)))
        i = j
    return spans
