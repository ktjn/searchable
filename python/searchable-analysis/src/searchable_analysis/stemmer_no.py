from searchable_analysis.stemmer_scandinavian import (
    longest_suffix_in_region,
    mark_scandinavian_region,
)

VOWELS = frozenset("aeêioòóôuyæåø")
S_ENDING = frozenset("bcdfghjlmnoptvyz")
MAIN_SUFFIXES = (
    "a",
    "e",
    "ede",
    "ande",
    "ende",
    "ane",
    "ene",
    "hetene",
    "en",
    "heten",
    "ar",
    "er",
    "heter",
    "as",
    "es",
    "edes",
    "endes",
    "enes",
    "hetenes",
    "ens",
    "hetens",
    "ets",
    "et",
    "het",
    "ast",
    "ers",
    "s",
    "erte",
    "ert",
)
ERS_KEEP = ("amm", "ast", "ind", "kap", "kk", "lt", "nk", "omm", "pp", "v", "øst")
ERS_DELETE = ("giv", "hav", "skap")


def _mark_region(word: str) -> int:
    apostrophe = word.find("'")
    return max(3, apostrophe + 1) if apostrophe >= 0 else mark_scandinavian_region(word, VOWELS)


def _valid_s_ending(prefix: str) -> bool:
    last = prefix[-1:]
    if last in S_ENDING:
        return True
    if last == "r":
        return prefix[-2:-1] != "e"
    if last == "k":
        return bool(prefix[-2:-1]) and prefix[-2:-1] not in VOWELS
    return False


def _main_suffix(word: str, p1: int) -> str:
    suffix = longest_suffix_in_region(word, p1, MAIN_SUFFIXES)
    if suffix is None:
        return word
    prefix = word[: -len(suffix)]
    if suffix == "ers":
        if prefix.endswith(ERS_DELETE):
            return prefix
        return word if prefix.endswith(ERS_KEEP) else prefix
    if suffix == "s":
        return prefix if _valid_s_ending(prefix) else word
    if suffix in ("erte", "ert"):
        return prefix + "er"
    return prefix


def stem_norwegian(word: str) -> str:
    if not word:
        return word
    p1 = _mark_region(word)
    result = _main_suffix(word, p1)
    if longest_suffix_in_region(result, p1, ("dt", "vt")) is not None:
        result = result[:-1]
    suffix = longest_suffix_in_region(
        result,
        p1,
        ("leg", "eleg", "ig", "eig", "lig", "elig", "els", "lov", "elov", "slov", "hetslov"),
    )
    if suffix is not None:
        result = result[: -len(suffix)]
    return result[:-1] if result.endswith("'") else result
