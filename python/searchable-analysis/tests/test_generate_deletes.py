from searchable_analysis import generate_deletes


def test_max_edits_1_includes_original_and_single_deletions():
    result = set(generate_deletes("cat", 1))
    assert result == {"cat", "at", "ct", "ca"}


def test_max_edits_2_includes_double_deletions():
    result = set(generate_deletes("cat", 2))
    assert "cat" in result
    assert "at" in result and "ct" in result and "ca" in result
    assert "a" in result and "c" in result and "t" in result


def test_handles_unicode_code_points_not_utf16_units():
    # "café" — deleting the "é" must remove the whole code point.
    result = set(generate_deletes("café", 1))
    assert "caf" in result
