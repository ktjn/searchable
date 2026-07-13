import re

A = frozenset("aàáâä")
E = frozenset("eèéêë")
I = frozenset("iìíîï")
O = frozenset("oòóôö")
U = frozenset("uùúûü")
AEIOU = A | E | I | O | U
AIOU = A | I | O | U
VOWELS = AEIOU | {"y"}


def _vowel_length_at(word: str, index: int) -> int:
    if word[index:index + 2] == "ij":
        return 2
    return 1 if word[index:index + 1] in VOWELS else 0


def _measure(word: str) -> tuple[int, int]:
    regions: list[int] = []
    index = 0
    while len(regions) < 2 and index < len(word):
        while index < len(word) and _vowel_length_at(word, index) == 0:
            index += 1
        vowels = 0
        while index < len(word):
            length = _vowel_length_at(word, index)
            if length == 0:
                break
            vowels += 1
            index += length
        if vowels == 0 or index >= len(word):
            break
        index += 1
        regions.append(index)
    return (regions + [len(word), len(word)])[:2]


def _is_c(prefix: str) -> bool:
    return bool(prefix) and not prefix.endswith("ij") and prefix[-1] not in VOWELS


def _is_v(prefix: str) -> bool:
    return prefix.endswith("ij") or prefix[-1:] in VOWELS


def _in_region(word: str, suffix: str, region: int) -> bool:
    return len(word) - len(suffix) >= region


def _longest_suffix(word: str, suffixes: tuple[str, ...]) -> str | None:
    return max((suffix for suffix in suffixes if word.endswith(suffix)), key=len, default=None)


def _lengthen_v(word: str) -> str:
    if len(word) < 2 or word[-1] in VOWELS or word[-1] in "wx":
        return word
    last, prefix = word[-1], word[:-1]
    if prefix.endswith("eë"):
        return prefix[:-2] + "eëe" + last
    if prefix.endswith("ië"):
        return prefix[:-2] + "iee" + last
    vowel, before = prefix[-1:], prefix[:-1]
    if vowel in A | O | U:
        if not before or before[-1] not in AEIOU:
            return prefix + vowel + last
    elif vowel in E and vowel != "ë":
        if before and before[-1] in AEIOU:
            return word
        base = before if not before else before[:-1]
        if base[-1:] in AIOU or (len(base) == 1 and base in E):
            return word
        skipped = base[:-1]
        if len(skipped) >= 2 and skipped[-1] in AIOU and skipped[-2] not in AEIOU:
            return word
        return prefix + vowel + last
    return word


def _step1(word: str, p1: int) -> tuple[str, bool]:
    suffix = _longest_suffix(word, ("'s", "ies", "és", "aus", "nde", "en", "es", "s"))
    if suffix is None:
        return word, False
    prefix = word[:-len(suffix)]
    if suffix == "'s":
        return prefix, True
    if suffix == "s":
        if not _in_region(word, suffix, p1) or not _is_c(prefix) or (prefix.endswith("t") and len(prefix) - 1 >= p1):
            return word, False
        return prefix, True
    if suffix == "ies":
        return (prefix + "ie", True) if _in_region(word, suffix, p1) else (word, False)
    if suffix == "es":
        if prefix.endswith("ar") and len(prefix) - 2 >= p1 and _is_c(prefix[:-2]):
            return _lengthen_v(prefix), True
        if prefix.endswith("er") and len(prefix) - 2 >= p1 and _is_c(prefix[:-2]):
            return prefix, True
        return (prefix + "e", True) if _in_region(word, suffix, p1) and _is_c(prefix) else (word, False)
    if suffix == "és":
        return (prefix + "é", True) if _in_region(word, suffix, p1) else (word, False)
    if suffix == "aus":
        return (prefix + "au", True) if _in_region(word, suffix, p1) and _is_v(prefix) else (word, False)
    if suffix == "en":
        if prefix.endswith("hed") and len(prefix) - 3 >= p1:
            return prefix[:-3] + "heid", True
        if prefix.endswith("nd"):
            return prefix, True
        if prefix.endswith("d") and len(prefix) - 1 >= p1 and _is_c(prefix[:-1]):
            return prefix[:-1], True
        if prefix.endswith(("i", "j")) and _is_v(prefix[:-1]):
            return prefix, True
        return (_lengthen_v(prefix), True) if _in_region(word, suffix, p1) and _is_c(prefix) else (word, False)
    if suffix == "nde":
        return prefix + "nd", True
    return word, False


def _step2(word: str, p1: int) -> tuple[str, bool]:
    suffix = _longest_suffix(word, ("lijke", "ische", "ieve", "ene", "je", "ge", "de", "te", "se", "re", "le"))
    if suffix is None:
        return word, False
    prefix = word[:-len(suffix)]
    if suffix == "je":
        if prefix.endswith("'t"):
            return prefix[:-2], True
        if prefix.endswith("et") and len(prefix) - 2 >= p1 and _is_c(prefix[:-2]):
            return prefix[:-2], True
        if prefix.endswith("rnt"):
            return prefix[:-3] + "rn", True
        if prefix.endswith("t") and len(prefix) - 1 >= p1 and _is_v(prefix[:-2]):
            return prefix[:-1], True
        if prefix.endswith("ink"):
            return prefix[:-3] + "ing", True
        if prefix.endswith("mp"):
            return prefix[:-2] + "m", True
        if prefix.endswith("'") and len(prefix) - 1 >= p1:
            return prefix[:-1], True
        return (prefix, True) if _in_region(word, suffix, p1) and _is_c(prefix) else (word, False)
    if not _in_region(word, suffix, p1):
        return word, False
    replacements = {"ge": "g", "lijke": "lijk", "ische": "isch", "te": "t", "se": "s", "re": "r"}
    if suffix in replacements:
        return prefix + replacements[suffix], True
    if suffix == "de":
        return (prefix, True) if _is_c(prefix) else (word, False)
    if suffix == "le":
        return _lengthen_v(prefix + "l"), True
    if suffix == "ene":
        return (_lengthen_v(prefix + "en"), True) if _is_c(prefix) else (word, False)
    if suffix == "ieve":
        return (prefix + "ief", True) if _is_c(prefix) else (word, False)
    return word, False


def _step3(word: str, p1: int, p2: int) -> tuple[str, bool]:
    suffix = _longest_suffix(word, ("iteit", "isme", "erij", "arij", "heid", "ster", "rder", "atie", "ing", "sel", "fie", "gie", "tst", "dst"))
    if suffix is None:
        return word, False
    prefix = word[:-len(suffix)]
    if suffix == "atie":
        return (prefix + "eer", True) if _in_region(word, suffix, p1) else (word, False)
    if suffix == "iteit":
        return (_lengthen_v(prefix), True) if _in_region(word, suffix, p1) else (word, False)
    if suffix in ("heid", "sel", "ster"):
        return (prefix, True) if _in_region(word, suffix, p1) else (word, False)
    if suffix == "rder":
        return prefix + "r", True
    if suffix in ("ing", "isme", "erij"):
        if prefix.endswith("ild"):
            return prefix + "er", True
        return (_lengthen_v(prefix), True) if _in_region(word, suffix, p1) else (word, False)
    if suffix == "arij":
        return (prefix + "aar", True) if _in_region(word, suffix, p1) and _is_c(prefix) else (word, False)
    if suffix in ("fie", "gie"):
        return (_lengthen_v(prefix + suffix[0]), True) if _in_region(word, suffix, p2) else (word, False)
    if suffix in ("tst", "dst"):
        return (prefix + suffix[0], True) if _in_region(word, suffix, p1) and _is_c(prefix) else (word, False)
    return word, False


def _step4(word: str, p1: int) -> tuple[str, bool]:
    first = _longest_suffix(word, ("achtiger", "achtigst", "eriger", "erigst", "ioneel", "lijker", "lijkst", "achtig", "atief", "baar", "naar", "laar", "raar", "tant", "erig", "end"))
    if first is not None and _in_region(word, first, p1):
        prefix = word[:-len(first)]
        replacements = {"ioneel": "ie", "atief": "eer", "tant": "teer", "lijker": "lijk", "lijkst": "lijk"}
        if first in replacements:
            return prefix + replacements[first], True
        if first == "baar" or first.startswith("achtig"):
            return prefix, True
        if first in ("naar", "laar", "raar") and _is_v(prefix):
            return prefix + first[0], True
        if first in ("erig", "eriger", "erigst", "end") and _is_c(prefix):
            return _lengthen_v(prefix), True
    second = _longest_suffix(word, ("iger", "igst", "ig"))
    if second is None or not _in_region(word, second, p1):
        return word, False
    prefix = word[:-len(second)]
    if prefix == "inn" or not _is_c(prefix):
        return word, False
    return _lengthen_v(prefix), True


def _valid_ge_at(word: str, index: int) -> bool:
    rest = word[index + 2:]
    if len(rest) < 3:
        return False
    cursor = 0
    while cursor < len(rest) and _vowel_length_at(rest, cursor) == 0:
        cursor += 1
    if cursor >= len(rest):
        return False
    while cursor < len(rest):
        length = _vowel_length_at(rest, cursor)
        if length == 0:
            break
        cursor += length
    return cursor < len(rest)


def _remove_ge(word: str, index: int) -> str:
    result = word[:index] + word[index + 2:]
    if result[index:index + 1] in ("ë", "ï"):
        result = result[:index] + ("e" if result[index] == "ë" else "i") + result[index + 1:]
    return result


def _remove_prefix_ge(word: str) -> tuple[str, bool]:
    if not word.startswith("ge") or not _valid_ge_at(word, 0):
        return word, False
    rest = word[2:]
    if rest.startswith("eft") or (rest.startswith("val") and not rest.startswith("vali")) or rest.startswith(("vaa", "vare")):
        return word, False
    return _remove_ge(word, 0), True


def _remove_infix_ge(word: str) -> tuple[str, bool]:
    index = word.find("ge", 1)
    return (_remove_ge(word, index), True) if index >= 0 and _valid_ge_at(word, index) else (word, False)


def _step1c(word: str, p1: int) -> str:
    if word.endswith("d") and len(word) - 1 >= p1 and _is_c(word[:-1]):
        prefix = word[:-1]
        if prefix.endswith("n") and len(prefix) - 1 >= p1:
            return word
        return "inn" if prefix == "in" else prefix
    if word.endswith("t") and len(word) - 1 >= p1 and _is_c(word[:-1]):
        prefix = word[:-1]
        if (prefix.endswith("h") and len(prefix) - 1 >= p1) or prefix == "en":
            return word
        return prefix
    return word


def _step7(word: str) -> tuple[str, bool]:
    return (word[:-1], True) if word.endswith(("kt", "ft", "pt")) else (word, False)


def _step6(word: str) -> str:
    pair = word[-2:]
    if re.fullmatch(r"([bcdfghjklmnpqrstvwxyz])\1", pair):
        return word if pair == "nn" and word == "inn" else word[:-1]
    if word.endswith("v"):
        return word[:-1] + "f"
    if word.endswith("z"):
        return word[:-1] + "s"
    return word


def stem_dutch(word: str) -> str:
    if not word:
        return word
    p1, p2 = _measure(word)
    result, stemmed = word, False
    for step in (_step1, _step2):
        result, changed = step(result, p1)
        stemmed |= changed
    result, changed = _step3(result, p1, p2)
    stemmed |= changed
    result, changed = _step4(result, p1)
    stemmed |= changed
    result, changed = _remove_prefix_ge(result)
    if changed:
        p1, _ = _measure(result)
        result = _step1c(result, p1)
        stemmed = True
    result, changed = _remove_infix_ge(result)
    if changed:
        p1, _ = _measure(result)
        result = _step1c(result, p1)
        stemmed = True
    result, changed = _step7(result)
    stemmed |= changed
    return _step6(result) if stemmed else result
