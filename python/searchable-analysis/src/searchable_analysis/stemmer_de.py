_VOWELS = {"a", "e", "i", "o", "u", "y", "ä", "ö", "ü"}
_S_ENDING = {"b", "d", "f", "g", "h", "k", "l", "m", "n", "r", "t"}
_ST_ENDING = {"b", "d", "f", "g", "h", "k", "l", "m", "n", "t"}
_ET_ENDING = {"d", "f", "g", "k", "l", "m", "n", "r", "s", "t", "U", "z", "ä"}
_ET_EXCEPTIONS = ["geordn", "intern", "plan", "tick", "tr"]
_POSTLUDE_MAP = {"Y": "y", "U": "u", "ä": "a", "ö": "o", "ü": "u"}


def _is_vowel(ch: str | None) -> bool:
    return ch is not None and ch in _VOWELS


def _mark_semivowels(word: str) -> str:
    chars = list(word)
    for i in range(1, len(chars) - 1):
        c = chars[i]
        if c in ("u", "y") and _is_vowel(chars[i - 1]) and _is_vowel(chars[i + 1]):
            chars[i] = "U" if c == "u" else "Y"
    return "".join(chars)


def _fold_digraphs(word: str) -> str:
    result: list[str] = []
    i = 0
    n = len(word)
    while i < n:
        c = word[i]
        two = word[i : i + 2]
        if c == "ß":
            result.append("ss")
            i += 1
        elif two == "ae":
            result.append("ä")
            i += 2
        elif two == "oe":
            result.append("ö")
            i += 2
        elif two == "ue":
            result.append("ü")
            i += 2
        elif two == "qu":
            result.append("qu")
            i += 2
        else:
            result.append(c)
            i += 1
    return "".join(result)


def _find_region_start(word: str, start: int) -> int:
    length = len(word)
    i = start
    while i < length and not _is_vowel(word[i]):
        i += 1
    if i >= length:
        return length
    i += 1
    while i < length and _is_vowel(word[i]):
        i += 1
    if i >= length:
        return length
    i += 1
    return i


def _mark_regions(word: str) -> tuple[int, int]:
    raw_p1 = _find_region_start(word, 0)
    x = 3 if len(word) >= 3 else 0
    p1 = x if raw_p1 < x else raw_p1
    p2 = _find_region_start(word, raw_p1)
    return p1, p2


def _step1(word: str, p1: int) -> str:
    suffixes = ["erinnen", "erin", "ern", "lns", "em", "er", "en", "es", "ln", "e", "s"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p1:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched == "em":
        before = word[:start_idx]
        return word if before.endswith("syst") else before
    if matched in ("ern", "er", "erin", "erinnen"):
        return word[:start_idx]
    if matched in ("e", "en", "es"):
        result = word[:start_idx]
        if result.endswith("niss"):
            result = result[:-1]
        return result
    if matched == "s":
        before = word[:start_idx]
        last = before[-1] if before else ""
        return before if last in _S_ENDING else word
    if matched in ("ln", "lns"):
        return word[:start_idx] + "l"
    return word


def _step2(word: str, p1: int) -> str:
    suffixes = ["est", "en", "er", "st", "et"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p1:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched in ("en", "er", "est"):
        return word[:start_idx]
    if matched == "st":
        before = word[:start_idx]
        last = before[-1] if before else ""
        if last not in _ST_ENDING:
            return word
        return before if len(before) > 3 else word
    if matched == "et":
        before = word[:start_idx]
        last = before[-1] if before else ""
        if last not in _ET_ENDING:
            return word
        return word if any(before.endswith(exc) for exc in _ET_EXCEPTIONS) else before
    return word


def _step3(word: str, p1: int, p2: int) -> str:
    suffixes = ["isch", "lich", "heit", "keit", "end", "ung", "ig", "ik"]
    matched = None
    start_idx = -1
    for suf in suffixes:
        if len(word) >= len(suf) and word.endswith(suf):
            idx = len(word) - len(suf)
            if idx >= p2:
                matched = suf
                start_idx = idx
                break
    if matched is None:
        return word
    if matched in ("end", "ung"):
        result = word[:start_idx]
        if result.endswith("ig"):
            ig_start = len(result) - 2
            before_ig = result[:ig_start]
            last = before_ig[-1] if before_ig else ""
            if ig_start >= p2 and last != "e":
                result = before_ig
        return result
    if matched in ("ig", "ik", "isch"):
        before = word[:start_idx]
        last = before[-1] if before else ""
        return word if last == "e" else before
    if matched in ("lich", "heit"):
        result = word[:start_idx]
        for extra in ("er", "en"):
            if result.endswith(extra):
                idx2 = len(result) - len(extra)
                if idx2 >= p1:
                    result = result[:idx2]
                break
        return result
    if matched == "keit":
        result = word[:start_idx]
        for extra in ("lich", "ig"):
            if result.endswith(extra):
                idx2 = len(result) - len(extra)
                if idx2 >= p2:
                    result = result[:idx2]
                break
        return result
    return word


def _step4(word: str) -> str:
    for suf in ("'sch", "'s", "'"):
        if len(word) >= len(suf) and word.endswith(suf):
            before = word[: len(word) - len(suf)]
            return before if len(before) >= 2 else word
    return word


def _postlude(word: str) -> str:
    return "".join(_POSTLUDE_MAP.get(c, c) for c in word)


def stem_german(word: str) -> str:
    if len(word) == 0:
        return word
    w = _fold_digraphs(_mark_semivowels(word))
    p1, p2 = _mark_regions(w)
    w = _step1(w, p1)
    w = _step2(w, p1)
    w = _step3(w, p1, p2)
    w = _step4(w)
    return _postlude(w)
