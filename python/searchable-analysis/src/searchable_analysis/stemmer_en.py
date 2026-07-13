import re
from dataclasses import dataclass
from typing import Callable

_VOWEL = re.compile(r"[aeiou]")


def _is_consonant(word: str, i: int) -> bool:
    if i < 0 or i >= len(word):
        return False
    c = word[i]
    if _VOWEL.match(c):
        return False
    if c != "y":
        return True
    return i == 0 or not _is_consonant(word, i - 1)


def _measure(word: str) -> int:
    i = 0
    n = len(word)
    while i < n and _is_consonant(word, i):
        i += 1
    m = 0
    while i < n:
        while i < n and not _is_consonant(word, i):
            i += 1
        if i >= n:
            break
        while i < n and _is_consonant(word, i):
            i += 1
        m += 1
    return m


def _has_vowel(word: str) -> bool:
    return any(not _is_consonant(word, i) for i in range(len(word)))


def _ends_double_consonant(word: str) -> bool:
    n = len(word)
    if n < 2:
        return False
    return (
        word[n - 1] == word[n - 2]
        and _is_consonant(word, n - 1)
        and _is_consonant(word, n - 2)
    )


def _ends_cvc(word: str) -> bool:
    n = len(word)
    if n < 3:
        return False
    last = word[n - 1]
    return (
        _is_consonant(word, n - 3)
        and not _is_consonant(word, n - 2)
        and _is_consonant(word, n - 1)
        and last not in ("w", "x", "y")
    )


@dataclass(frozen=True)
class _Rule:
    suffix: str
    replacement: str
    condition: Callable[[str], bool] | None = None


def _apply_rules(word: str, rules: list[_Rule]) -> str:
    for rule in rules:
        if not word.endswith(rule.suffix):
            continue
        stem = word[: len(word) - len(rule.suffix)]
        if rule.condition and not rule.condition(stem):
            return word
        return stem + rule.replacement
    return word


def _step1a(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("sses", "ss"),
            _Rule("ies", "i"),
            _Rule("ss", "ss"),
            _Rule("s", ""),
        ],
    )


def _restore_after_step1b(stem: str) -> str:
    if stem.endswith("at") or stem.endswith("bl") or stem.endswith("iz"):
        return stem + "e"
    if _ends_double_consonant(stem) and stem[-1] not in ("l", "s", "z"):
        return stem[:-1]
    if _measure(stem) == 1 and _ends_cvc(stem):
        return stem + "e"
    return stem


def _step1b(word: str) -> str:
    if word.endswith("eed"):
        stem = word[:-3]
        return stem + "ee" if _measure(stem) > 0 else word
    for suffix in ("ed", "ing"):
        if not word.endswith(suffix):
            continue
        stem = word[: len(word) - len(suffix)]
        if not _has_vowel(stem):
            continue
        return _restore_after_step1b(stem)
    return word


def _step1c(word: str) -> str:
    if not word.endswith("y"):
        return word
    stem = word[:-1]
    if len(stem) == 0 or not _has_vowel(stem):
        return word
    return stem + "i"


def _m0(stem: str) -> bool:
    return _measure(stem) > 0


def _step2(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("ational", "ate", _m0),
            _Rule("tional", "tion", _m0),
            _Rule("enci", "ence", _m0),
            _Rule("anci", "ance", _m0),
            _Rule("izer", "ize", _m0),
            _Rule("bli", "ble", _m0),
            _Rule("alli", "al", _m0),
            _Rule("entli", "ent", _m0),
            _Rule("eli", "e", _m0),
            _Rule("ousli", "ous", _m0),
            _Rule("ization", "ize", _m0),
            _Rule("ation", "ate", _m0),
            _Rule("ator", "ate", _m0),
            _Rule("alism", "al", _m0),
            _Rule("iveness", "ive", _m0),
            _Rule("fulness", "ful", _m0),
            _Rule("ousness", "ous", _m0),
            _Rule("aliti", "al", _m0),
            _Rule("iviti", "ive", _m0),
            _Rule("biliti", "ble", _m0),
            _Rule("logi", "log", _m0),
        ],
    )


def _step3(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("icate", "ic", _m0),
            _Rule("ative", "", _m0),
            _Rule("alize", "al", _m0),
            _Rule("iciti", "ic", _m0),
            _Rule("ical", "ic", _m0),
            _Rule("ful", "", _m0),
            _Rule("ness", "", _m0),
        ],
    )


def _m1(stem: str) -> bool:
    return _measure(stem) > 1


def _step4(word: str) -> str:
    return _apply_rules(
        word,
        [
            _Rule("al", "", _m1),
            _Rule("ance", "", _m1),
            _Rule("ence", "", _m1),
            _Rule("er", "", _m1),
            _Rule("ic", "", _m1),
            _Rule("able", "", _m1),
            _Rule("ible", "", _m1),
            _Rule("ant", "", _m1),
            _Rule("ement", "", _m1),
            _Rule("ment", "", _m1),
            _Rule("ent", "", _m1),
            _Rule(
                "ion",
                "",
                lambda stem: _m1(stem) and (stem.endswith("s") or stem.endswith("t")),
            ),
            _Rule("ou", "", _m1),
            _Rule("ism", "", _m1),
            _Rule("ate", "", _m1),
            _Rule("iti", "", _m1),
            _Rule("ous", "", _m1),
            _Rule("ive", "", _m1),
            _Rule("ize", "", _m1),
        ],
    )


def _step5a(word: str) -> str:
    if not word.endswith("e"):
        return word
    stem = word[:-1]
    m = _measure(stem)
    if m > 1 or (m == 1 and not _ends_cvc(stem)):
        return stem
    return word


def _step5b(word: str) -> str:
    if word.endswith("ll") and _measure(word[:-1]) > 1:
        return word[:-1]
    return word


_ASCII_LETTERS_ONLY = re.compile(r"^[a-z]+$")


def stem_english(word: str) -> str:
    if len(word) <= 2 or not _ASCII_LETTERS_ONLY.match(word):
        return word
    result = _step1a(word)
    result = _step1b(result)
    result = _step1c(result)
    result = _step2(result)
    result = _step3(result)
    result = _step4(result)
    result = _step5a(result)
    result = _step5b(result)
    return result
