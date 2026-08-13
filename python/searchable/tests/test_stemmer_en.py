from pathlib import Path

from searchable.analysis.stemmer_en import stem_english

_FIXTURES = Path(__file__).parent / "fixtures"


def test_leaves_short_words_unchanged():
    assert stem_english("a") == "a"
    assert stem_english("is") == "is"


def test_leaves_non_ascii_letter_input_unchanged():
    assert stem_english("café") == "café"
    assert stem_english("2024") == "2024"


def test_strips_plural_and_inflectional_suffixes():
    assert stem_english("caresses") == "caress"
    assert stem_english("ponies") == "poni"
    assert stem_english("ties") == "ti"
    assert stem_english("caress") == "caress"
    assert stem_english("cats") == "cat"
    assert stem_english("feed") == "feed"
    assert stem_english("agreed") == "agre"
    assert stem_english("plastered") == "plaster"
    assert stem_english("motoring") == "motor"
    assert stem_english("hopping") == "hop"
    assert stem_english("tanned") == "tan"
    assert stem_english("falling") == "fall"
    assert stem_english("sized") == "size"


def test_converts_trailing_y_to_i_only_when_stem_has_a_vowel():
    assert stem_english("happy") == "happi"
    assert stem_english("sky") == "sky"


def test_does_not_strip_a_longer_nested_suffixes_shorter_alternative_on_condition_failure():
    # measure("agree") is 1, so neither "ement" (m>1) nor "ment" (m>1)
    # fires -- a naive implementation that falls through to the shorter
    # nested "ent" suffix would wrongly strip it anyway.
    assert stem_english("agreement") == "agreement"
    assert stem_english("argument") == "argument"
    assert stem_english("element") == "element"
    assert stem_english("implements") == "implement"


def test_uses_bli_to_ble_per_the_later_errata_and_adds_logi_to_log():
    assert stem_english("corruptibly") == "corrupt"
    assert stem_english("apology") == "apolog"


def test_matches_every_word_stem_pair_in_the_23531_word_porter_reference_vocabulary():
    words = _FIXTURES.joinpath("porter-input.txt").read_text().strip().split("\n")
    stems = _FIXTURES.joinpath("porter-output.txt").read_text().strip().split("\n")
    assert len(words) == len(stems)
    assert len(words) > 20000

    mismatches = []
    for word, expected in zip(words, stems, strict=True):
        actual = stem_english(word)
        if actual != expected:
            mismatches.append(f'{word}: expected "{expected}", got "{actual}"')
    assert mismatches[:20] == []
    assert len(mismatches) == 0
