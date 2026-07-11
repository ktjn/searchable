from dataclasses import dataclass


@dataclass(frozen=True)
class TokenSpan:
    text: str
    is_word_like: bool
