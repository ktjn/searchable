import re

_HIRAGANA_KATAKANA = re.compile(r"[぀-ヿ]")
_HAN = re.compile(r"[㐀-䶿一-鿿]")
_THAI = re.compile(r"[฀-๿]")
_LAO = re.compile(r"[຀-໿]")
_KHMER = re.compile(r"[ក-៿]")

# Fraction of "letter-ish" characters that must be a given script before
# this module trusts a script-based classification over Latin scoring.
_SCRIPT_THRESHOLD = 0.3

_LATIN_MARKER_WORDS: dict[str, set[str]] = {
    "en": {
        "the", "and", "of", "to", "is", "in", "that", "for", "with", "as",
        "was", "are", "this", "have", "from", "by", "an", "be", "or", "on",
    },
    "de": {
        "der", "die", "das", "und", "ist", "nicht", "mit", "für", "auf",
        "sich", "den", "dem", "eine", "einen", "ein", "zu", "von", "im",
        "auch", "sind",
    },
    "sv": {"och", "är", "att", "inte", "också", "detta"},
    "nl": {"het", "een", "van", "niet", "zijn", "wij"},
    "nb": {"ikke", "jeg", "hva", "også", "hvordan", "hvem"},
    "nn": {"ikkje", "eg", "kva", "òg", "korleis", "kven"},
}

# Approximates \p{L}+ (TS) via a Unicode word-character class minus
# digits/underscore -- Python's stdlib `re` has no \p{L} without a
# third-party module.
_WORD_TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def _count_script_chars(text: str) -> dict:
    han = kana = thai = lao = khmer = letters = 0
    for ch in text:
        if not ch.isalpha():
            continue
        letters += 1
        if _HIRAGANA_KATAKANA.match(ch):
            kana += 1
        elif _HAN.match(ch):
            han += 1
        elif _THAI.match(ch):
            thai += 1
        elif _LAO.match(ch):
            lao += 1
        elif _KHMER.match(ch):
            khmer += 1
    return {"han": han, "kana": kana, "thai": thai, "lao": lao, "khmer": khmer, "letters": letters}


def _count_marker_words(text: str, words: set[str]) -> int:
    count = 0
    for token in _WORD_TOKEN_RE.findall(text.lower()):
        if token in words:
            count += 1
    return count


def detect_language(text: str, candidate_codes: list[str]) -> str | None:
    candidates = set(candidate_codes)
    counts = _count_script_chars(text)
    letters = counts["letters"]
    if letters > 0:
        if (counts["han"] + counts["kana"]) / letters >= _SCRIPT_THRESHOLD:
            cjk_code = "ja" if counts["kana"] > 0 else "zh"
            return cjk_code if cjk_code in candidates else None
        if counts["thai"] / letters >= _SCRIPT_THRESHOLD:
            return "th" if "th" in candidates else None
        if counts["lao"] / letters >= _SCRIPT_THRESHOLD:
            return "lo" if "lo" in candidates else None
        if counts["khmer"] / letters >= _SCRIPT_THRESHOLD:
            return "km" if "km" in candidates else None

    best_code: str | None = None
    best_count = 0
    tied = False
    for code in candidates:
        words = _LATIN_MARKER_WORDS.get(code)
        if not words:
            continue
        count = _count_marker_words(text, words)
        if count == 0:
            continue
        if count > best_count:
            best_code = code
            best_count = count
            tied = False
        elif count == best_count:
            tied = True
    return None if tied else best_code
