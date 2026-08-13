from pathlib import Path

from searchable.analysis.stemmer_de import stem_german

_FIXTURES = Path(__file__).parent / "fixtures"


def test_folds_sharp_s_and_digraphs_to_umlauts_then_back_to_plain_vowels():
    # "bauen" -> the 'u' between two vowels marks as semivowel 'U', so
    # digraph folding leaves it alone; final postlude still folds it
    # back to plain 'u'.
    assert stem_german("bauen") == "bau"


def test_does_not_fold_ue_right_after_q():
    assert stem_german("quelle") == "quell"


def test_strips_a_trailing_apostrophe_possessive_form():
    assert stem_german("mandela's") == "mandela"


def test_leaves_empty_string_unchanged():
    assert stem_german("") == ""


def test_matches_every_word_stem_pair_in_the_35053_word_snowball_reference_vocabulary():
    words = _FIXTURES.joinpath("german-input.txt").read_text(encoding="utf-8").strip().split("\n")
    stems = _FIXTURES.joinpath("german-output.txt").read_text(encoding="utf-8").strip().split("\n")
    assert len(words) == len(stems)
    assert len(words) > 30000

    mismatches = []
    for word, expected in zip(words, stems, strict=True):
        actual = stem_german(word)
        if actual != expected:
            mismatches.append(f'{word}: expected "{expected}", got "{actual}"')
    assert mismatches[:20] == []
    assert len(mismatches) == 0
