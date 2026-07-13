def mark_scandinavian_region(word: str, vowels: frozenset[str]) -> int:
    index = 0
    while index < len(word) and word[index] not in vowels:
        index += 1
    while index < len(word) and word[index] in vowels:
        index += 1
    if index < len(word):
        index += 1
    return max(3, index)


def longest_suffix_in_region(word: str, region_start: int, suffixes: tuple[str, ...]) -> str | None:
    matches = [suffix for suffix in suffixes if len(word) - len(suffix) >= region_start and word.endswith(suffix)]
    return max(matches, key=len, default=None)
