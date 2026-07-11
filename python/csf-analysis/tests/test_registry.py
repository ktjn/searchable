import pytest

from csf_analysis.language_profile import english
from csf_analysis.registry import get_language_profile, get_registered_language_codes


def test_get_language_profile_returns_the_registered_profile():
    assert get_language_profile("en") is english


def test_get_language_profile_raises_for_unregistered_code():
    with pytest.raises(ValueError, match='no LanguageProfile registered for "xx"'):
        get_language_profile("xx")


def test_get_registered_language_codes_lists_all_seven():
    codes = get_registered_language_codes()
    assert set(codes) == {"en", "de", "zh", "ja", "th", "km", "lo"}
