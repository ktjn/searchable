import gzip
from collections.abc import Callable
from pathlib import Path

FIXTURES = Path(__file__).parents[3] / "spec" / "fixtures" / "snowball"


def assert_snowball_vocabulary(language: str, stem: Callable[[str], str]) -> None:
    with gzip.open(FIXTURES / f"{language}-input.txt.gz", "rt", encoding="utf-8") as source:
        words = source.read().splitlines()
    with gzip.open(FIXTURES / f"{language}-output.txt.gz", "rt", encoding="utf-8") as source:
        expected = source.read().splitlines()

    assert len(words) == len(expected)
    assert [stem(word) for word in words] == expected
