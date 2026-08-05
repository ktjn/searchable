from searchable_analysis.stemmer_scandinavian import (
    longest_suffix_in_region,
    mark_scandinavian_region,
)

VOWELS = frozenset("aeiouyåäö")
S_ENDING = frozenset("bcdfghjklmnoprtvy")
OST_ENDING = frozenset("iklnprtuv")
ET_EXCEPTIONS = (
    "h",
    "iet",
    "uit",
    "fab",
    "cit",
    "dit",
    "alit",
    "ilit",
    "mit",
    "nit",
    "pit",
    "rit",
    "sit",
    "tit",
    "ivit",
    "kvit",
    "xit",
    "kom",
    "rak",
    "pak",
    "stak",
)
MAIN_SUFFIXES = (
    "a",
    "arna",
    "erna",
    "heterna",
    "orna",
    "ad",
    "e",
    "ade",
    "ande",
    "arne",
    "are",
    "aste",
    "en",
    "anden",
    "aren",
    "heten",
    "ern",
    "ar",
    "er",
    "heter",
    "or",
    "as",
    "arnas",
    "ernas",
    "ornas",
    "es",
    "ades",
    "andes",
    "ens",
    "arens",
    "hetens",
    "erns",
    "at",
    "andet",
    "het",
    "ast",
    "s",
    "et",
)


def _valid_et_prefix(prefix: str) -> bool:
    if len(prefix) < 3 or prefix[-1] in VOWELS or prefix[-2] not in VOWELS:
        return False
    return not prefix.endswith(ET_EXCEPTIONS)


def _main_suffix(word: str, p1: int) -> str:
    suffix = longest_suffix_in_region(word, p1, MAIN_SUFFIXES)
    if suffix is None:
        return word
    if suffix == "s":
        before = word[:-1]
        if before.endswith("et") and _valid_et_prefix(before[:-2]):
            return before[:-2]
        return before if before[-1:] in S_ENDING else word
    if suffix == "et":
        return word[:-2] if _valid_et_prefix(word[:-2]) else word
    return word[: -len(suffix)]


def _consonant_pair(word: str, p1: int) -> str:
    suffix = longest_suffix_in_region(word, p1, ("dd", "gd", "nn", "dt", "gt", "kt", "tt"))
    return word if suffix is None else word[:-1]


def _other_suffix(word: str, p1: int) -> str:
    suffix = longest_suffix_in_region(word, p1, ("lig", "ig", "els", "öst", "fullt"))
    if suffix is None:
        return word
    prefix = word[: -len(suffix)]
    if suffix == "fullt":
        return prefix + "full"
    if suffix == "öst":
        return prefix + "ös" if prefix[-1:] in OST_ENDING else word
    return prefix


def stem_swedish(word: str) -> str:
    if not word:
        return word
    p1 = mark_scandinavian_region(word, VOWELS)
    return _other_suffix(_consonant_pair(_main_suffix(word, p1), p1), p1)
